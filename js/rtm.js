// Packages
const rtm_config = require('./rtm.config.json')

const app = module.exports = require('./mykoa.js')();
const Promise    = require('bluebird');
const ref        = require('ref');
const ffi        = require('ffi');
const ArrayType  = require('ref-array');
const fs         = require('fs');
const mkdirp     = require('mkdirp');
const send       = require('koa-send');
const rp         = require('request-promise');
const gcs        = require('@google-cloud/storage')();
const lzma       = require('lzma-native');     // one time decompression of segmentation
const lz4        = require('lz4');             // (de)compression of segmentation from/to redis
const os         = require('os');

const NodeRedis  = require('redis');           // cache for volume data (metadata, segment bboxes and sizes, segmentation)
const redis = NodeRedis.createClient('6379', '127.0.0.1', {return_buffers: true});
const log = require('./logging.js').log;

Promise.promisifyAll(NodeRedis.RedisClient.prototype);
Promise.promisifyAll(NodeRedis.Multi.prototype);

lzma.setPromiseAPI(Promise);

// Typedefs
const TaskMesherPtr = ref.refType(ref.types.void);
const SizeTArray = ArrayType(ref.types.size_t);
const FloatArray = ArrayType(ref.types.float);
const UInt8Ptr = ref.refType(ref.types.uint8);
const UInt16Ptr = ref.refType(ref.types.uint16);
const UInt32Ptr = ref.refType(ref.types.uint32);
const SizeTPtr = ref.refType(ref.types.size_t);
const UCharPtr = ref.refType(ref.types.uchar);
const CharPtr = ref.refType(ref.types.char);
const CharPtrPtr = ref.refType(ref.types.CString);

const TaskMesherLib = ffi.Library('../lib/librtm', {
    // TMesher * TaskMesher_Generate_uint8(unsigned char * volume, size_t dim[3], uint8_t * segments, uint8_t segmentCount, uint8_t mipCount);  
    "TaskMesher_Generate_uint8": [ TaskMesherPtr, [ UCharPtr, SizeTArray, UInt8Ptr, "uint8", "uint8" ] ],
    "TaskMesher_Generate_uint16": [ TaskMesherPtr, [ UCharPtr, SizeTArray, UInt16Ptr, "uint16", "uint8" ] ],
    "TaskMesher_Generate_uint32": [ TaskMesherPtr, [ UCharPtr, SizeTArray, UInt32Ptr, "uint32", "uint8" ] ],

    // void      TaskMesher_Release_uint8(TMesher * taskmesher);
    "TaskMesher_Release_uint8": [ "void", [ TaskMesherPtr ] ],
    "TaskMesher_Release_uint16": [ "void", [ TaskMesherPtr ] ],
    "TaskMesher_Release_uint32": [ "void", [ TaskMesherPtr ] ],

    // void      TaskMesher_GetRawMesh_uint8(TMesher * taskmesher, char ** data, size_t * length);
    "TaskMesher_GetRawMesh_uint8": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],
    "TaskMesher_GetRawMesh_uint16": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],
    "TaskMesher_GetRawMesh_uint32": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],

    //void      TaskMesher_GetSimplifiedMesh_uint8(TMesher * taskmesher, uint8_t lod, char ** data, size_t * length);
    "TaskMesher_GetSimplifiedMesh_uint8": [ "void", [ TaskMesherPtr , "uint8", CharPtrPtr, SizeTPtr ] ],
    "TaskMesher_GetSimplifiedMesh_uint16": [ "void", [ TaskMesherPtr , "uint8", CharPtrPtr, SizeTPtr ] ],
    "TaskMesher_GetSimplifiedMesh_uint32": [ "void", [ TaskMesherPtr , "uint8", CharPtrPtr, SizeTPtr ] ],

    //void      TaskMesher_ScaleVolume_uint8(unsigned char * in_volume, size_t from_dim[3], size_t to_dim[3], unsigned char * out_buffer)
    "TaskMesher_ScaleVolume_uint8": [ "void", [ UCharPtr, SizeTArray, SizeTArray, UCharPtr] ],
    "TaskMesher_ScaleVolume_uint16": [ "void", [ UCharPtr, SizeTArray, SizeTArray, UCharPtr] ],
    "TaskMesher_ScaleVolume_uint32": [ "void", [ UCharPtr, SizeTArray, SizeTArray, UCharPtr] ],

    //void      TaskMesher_ScaleMesh_uint8(TMesher * taskmesher, float scaleFactor[3])
    "TaskMesher_ScaleMesh_uint8": [ "void", [ TaskMesherPtr, FloatArray] ],
    "TaskMesher_ScaleMesh_uint16": [ "void", [ TaskMesherPtr, FloatArray] ],
    "TaskMesher_ScaleMesh_uint32": [ "void", [ TaskMesherPtr, FloatArray] ],
});

const typeLookup = {
    uint8: {
        constructor: Uint8Array,
        size: 1,
        generate: TaskMesherLib.TaskMesher_Generate_uint8,
        release: TaskMesherLib.TaskMesher_Release_uint8,
        getRawMesh: TaskMesherLib.TaskMesher_GetRawMesh_uint8,
        getSimplifiedMesh: TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint8,
        scaleVolume: TaskMesherLib.TaskMesher_ScaleVolume_uint8,
        scaleMesh: TaskMesherLib.TaskMesher_ScaleMesh_uint8
    },
    uint16: {
        constructor: Uint16Array,
        size: 2,
        generate: TaskMesherLib.TaskMesher_Generate_uint16,
        release: TaskMesherLib.TaskMesher_Release_uint16,
        getRawMesh: TaskMesherLib.TaskMesher_GetRawMesh_uint16,
        getSimplifiedMesh: TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint16,
        scaleVolume: TaskMesherLib.TaskMesher_ScaleVolume_uint16,
        scaleMesh: TaskMesherLib.TaskMesher_ScaleMesh_uint16
    },
    uint32: {
        constructor: Uint32Array,
        size: 4,
        generate: TaskMesherLib.TaskMesher_Generate_uint32,
        release: TaskMesherLib.TaskMesher_Release_uint32,
        getRawMesh: TaskMesherLib.TaskMesher_GetRawMesh_uint32,
        getSimplifiedMesh: TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint32,
        scaleVolume: TaskMesherLib.TaskMesher_ScaleVolume_uint32,
        scaleMesh: TaskMesherLib.TaskMesher_ScaleMesh_uint32
    }
};

/* cachedFetch

 * Input: request-promise input, e.g. { url: path, encoding: null }
 * 
 * Description: Checks if the requested object exists in cache (using path as key).
 *              If not, download it and send it gzipped to cache, otherwise retrieve and decompress it from cache.
 *              LZMA segmentation (file ends with .lzma) will be decompressed first before it is recompressed with
 *              gzip and send to cache (trading a slight increase in file size for major speedup).
 * 
 * Returns: Buffer
 */
function cachedFetch(request) {
    return redis.getAsync(request.url)
        .then(function (value) {
            if (value !== null) {
                const decoded_resp = lz4.decode(value);
                console.log(request.url + " successfully retrieved from cache.");
                return decoded_resp;
            }
            else
            {
                console.log(request.url + " not in cache. Downloading ...");
                return rp(request)
                .then(function (resp) {
                    console.log(request.url + " successfully downloaded.");
                    if (request.url.endsWith(".lzma")) {
                        console.log("Decompressing " + request.url);
                        return lzma.decompress(resp);
                    }
                    else {
                        return resp;
                    }
                })
                .then(function (decoded_resp) {
                    const compressed_resp = lz4.encode(decoded_resp);
                    console.log(request.url + " compressed (Ratio: " + (100.0 * compressed_resp.byteLength / decoded_resp.byteLength).toFixed(2) + " %)");
                    return redis.setAsync(request.url, compressed_resp)
                    .then(function () {
                        console.log(request.url + " sent to cache.");
                        return decoded_resp;
                    })
                    .catch(function (err) {
                        console.log("Caching " + request.url + " failed: " + err);
                        return decoded_resp;
                    });
                })
                .catch(function (err) {
                    throw new Error("Aquiring " + request.url + " failed: " + err);
                });
            }
        })
        .catch(function (err) {
            throw new Error("Unknown redis error when loading " + request.url + ": " + err);
        });
}

/* scaleVolume
 * 
 * Input: `volume` is a Buffer which we are scaling from `from_dimensions` to `to_dimensions`.
 *
 * Description: Used for downscaling large segmentations to create a quick preview.
 *              Scaling is lazy, speed linear wrt to `to_dimensions`.
 */
function scaleVolume(volume, intType, from_dimensions, to_dimensions) {
    return new Promise((fulfill, reject) => {
        const fromDimArray = new SizeTArray(3);
        fromDimArray[0] = from_dimensions.x;
        fromDimArray[1] = from_dimensions.y;
        fromDimArray[2] = from_dimensions.z;

        const toDimArray = new SizeTArray(3);
        toDimArray[0] = to_dimensions.x;
        toDimArray[1] = to_dimensions.y;
        toDimArray[2] = to_dimensions.z;
       
        downscaled = new Buffer(intType.size * to_dimensions.x * to_dimensions.y * to_dimensions.z);
        intType.scaleVolume.async(volume, fromDimArray, toDimArray, downscaled, function (err, success) {
            if (err) reject(err);
            else fulfill(downscaled);
        });
    });
}

/* scaleMesh
 * 
 * Input: ...
 *
 * Description: Scales the vertex positions by scaleFactor. Does not change the vertex normals (bad)!
 */
function scaleMesh(mesher, intType, scaleFactor) {
    return new Promise((fulfill, reject) => {
        const scaleArray = new FloatArray(3);
        scaleArray[0] = scaleFactor[0];
        scaleArray[1] = scaleFactor[1];
        scaleArray[2] = scaleFactor[2];
       
        intType.scaleMesh.async(mesher, scaleArray, function (err, success) {
            if (err) reject(err);
            else fulfill(mesher);
        });
    });
}

function generateMeshes(segmentation, dimensions, segments, mipCount, intType) {
    return new Promise((fulfill, reject) => {
        const segmentsTA = new intType.constructor(segments);
        const segmentsBuffer = Buffer.from(segmentsTA.buffer);
        segmentsBuffer.type = ref.types[intType];

        const dimensionsArray = new SizeTArray(3);
        dimensionsArray[0] = dimensions.x;
        dimensionsArray[1] = dimensions.y;
        dimensionsArray[2] = dimensions.z;


        intType.generate.async(segmentation, dimensionsArray, segmentsBuffer, segmentsTA.length, mipCount, function (err, mesher) {
            if (err) reject(err);
            else fulfill(mesher);
        });
    });
}

const MIP_COUNT = 4;
const writeBucket = gcs.bucket(rtm_config.overview_meshes_bucket);

const syncMap = new Map();
let processCount = 0;

function processRemesh(params) {
    return new Promise((fulfill, reject) => {
        const start = Date.now();
        const {task_id, cell_id, type, task_dim, bucket, path, segments, preview} = params;
        console.log("Remeshing task " + task_id);

        const segmentation_path = `https://storage.googleapis.com/${bucket}/${path}`;
        const intType = typeLookup[type];

        const processId = processCount++;
        syncMap.set(task_id, processId);

        cachedFetch({ url: segmentation_path + 'segmentation.lzma', encoding: null })
        .then((segmentation) => {
            if (preview) {
                return scaleVolume(segmentation, intType, task_dim, preview);
            } else {
                return segmentation;
            }
        })
        .then((segmentation) => {
            let dimensions = preview || task_dim;
            if (preview) {
                return generateMeshes(segmentation, preview, segments, 1, intType);
            } else {
                return generateMeshes(segmentation, task_dim, segments, MIP_COUNT, intType);
            }
            
        })
        .then((mesher) => {
            if (preview) { // restore original dimensions for downscaled preview
                let scale = [task_dim.x / preview.x, task_dim.y / preview.y, task_dim.z / preview.z];
                return scaleMesh(mesher, intType, scale);
            } else {
                return mesher;
            }
        })
        .then((mesher) => {
            if (syncMap.get(task_id) !== processId) {
                console.log('aborted save, not newest mesh', task_id, processId, syncMap.get(task_id));
                 fulfill();
            }
            syncMap.delete(task_id);

            let remaining = MIP_COUNT;
            for (let lod = 0; lod < MIP_COUNT; ++lod) {
                const lengthPtr = ref.alloc(ref.types.size_t);
                const dataPtr = ref.alloc(CharPtr);

                if (preview) { // Don't want simplified meshes for the preview, those are already low-poly
                    intType.getSimplifiedMesh(mesher, 0, dataPtr, lengthPtr);//, function (err) { DISABLED ASYNC DUE TO TIMING ISSUE
                } else {
                    intType.getSimplifiedMesh(mesher, lod, dataPtr, lengthPtr);//, function (err) { DISABLED ASYNC DUE TO TIMING ISSUE
                }

                const len = lengthPtr.deref();
                const data = ref.reinterpret(dataPtr.deref(), len);
                const buf = new Buffer(data.length);

                if (len === 0) {
                    console.log('0 byte array', lod, this.params);
                }

                data.copy(buf, 0, 0, data.length); // Without this nonsense I get { [Error: EFAULT: bad address in system call argument, write] errno: -14, code: 'EFAULT', syscall: 'write' }

                const mipPath = `meshes/${cell_id}/${task_id}/${lod}.dstrip`;
                const wstream = writeBucket.file(mipPath).createWriteStream({
                    gzip: true,
                    metadata: {
                        cacheControl: 'private, max-age=0, no-transform'
                    },
                    resumable: false // small speed boost, is it worth it?
                });
                wstream.on('error', function(e) {
                    console.error(e);
                    reject(e);
                });
                wstream.end(buf);

                wstream.on('finish', () => {
                    remaining--;
                    if (remaining === 0) {
                        fulfill(); 
                    }
                });
            }

            intType.release(mesher);
        }).catch((err) => {
            log.error({
                event: 'generateMeshes',
                err: err,
                params: params
            });
            reject(err);
        });        
    });
}

const MAX_PROCESSING_COUNT = Math.max(process.env.THREADS || 4, 2);
let currentProcessingCount = 0;
const remeshQueuePriorities = {
    high: [],
    low: []
};

let uniqueID = 0;
let activeTasks = {};

function checkRemeshQueue() {
    const remeshQueue = remeshQueuePriorities.high.length ? remeshQueuePriorities.high : remeshQueuePriorities.low;
    log.info({
        event: 'queueInfo',
        lengths: {
            high: remeshQueuePriorities.high.length,
            low: remeshQueuePriorities.low.length
        },
        processingCount: currentProcessingCount
    });

    if (remeshQueue.length > 0) {
        const memoryUsage = 1 - (os.freemem() / os.totalmem());

        if (currentProcessingCount >= MAX_PROCESSING_COUNT - 1 && remeshQueuePriorities.high.length == 0) {
            console.log(`${currentProcessingCount} meshes currently generated. Keeping one thread for emergencies available`);
        } else if (currentProcessingCount > 0 && memoryUsage > 0.9) {
            console.log(`Memory usage too high (${memoryUsage}, waiting for in-process remesh to finish.`);
        } else {
            const reqParams = remeshQueue.shift();
            currentProcessingCount++;
            const start = Date.now();
            const id = uniqueID++;

            activeTasks[id] = reqParams.task_id;

            processRemesh(reqParams).then(() => {
                console.log('time', reqParams.task_id, Date.now() - start);
                rp({
                    method: 'POST',
                    uri: `${rtm_config.eyewire_server}/1.0/task/${reqParams.task_id}/mesh_updated/`
                }).then(() => {
                    console.log('sent', reqParams.task_id, 'to site server');
                }).catch((err) => {
                    console.log('failed to send mesh_update', err); // no big deal if this fails?
                });
                delete activeTasks[id];
                currentProcessingCount--;
                checkRemeshQueue();
            }).catch((err) => {
                log.error({
                    event: 'processRemesh',
                    err: err,
                    params: reqParams
                });
                delete activeTasks[id];
                currentProcessingCount--;
                remeshQueue.push(reqParams);
                checkRemeshQueue();
            });
        }
    } else {
        console.log('queue empty');
    }
}

app.post('/remesh', null, {
        cell_id: { type: 'int', min: 0},
        task_id: { type: 'int', min: 0},
        type: ['uint8', 'uint16', 'uint32'],
        task_dim: {
            type: 'object',
            rule: {
                x: { type: 'int', min: 0},
                y: { type: 'int', min: 0},
                z: { type: 'int', min: 0}
            }
        },
        bucket: { type: 'string' },
        path: { type: 'string'},
        segments: {
            type: 'array',
            itemType: 'int',
            rule: { min: 0 }
        },
        priority: ['high', 'low'],
        preview: {
            required: false,
            type: 'object',
            rule: {
                x: { type: 'int', min: 0},
                y: { type: 'int', min: 0},
                z: { type: 'int', min: 0}
            }
        }
    }, function* () {
        // If high priority task, remove all pending low priority requests for this task
        if (this.params.priority === 'high') {
            remeshQueuePriorities.low = remeshQueuePriorities.low.filter((oParams) => {
                return oParams.task_id !== this.params.task_id;
            });
        }
        remeshQueuePriorities[this.params.priority].push(this.params);

        // If high priority task requested a preview, we send the original, high resolution request to the low priority queue.
        if (this.params.preview) {
            let highres = {
                cell_id: this.params.cell_id,
                task_id: this.params.task_id,
                type: this.params.type,
                task_dim: this.params.task_dim,
                bucket: this.params.bucket,
                path: this.params.path,
                segments: this.params.segments,
                priority: "low"
            }
            remeshQueuePriorities["low"].push(highres);
        }


        if (currentProcessingCount < MAX_PROCESSING_COUNT) checkRemeshQueue();
        else console.log('busy');
        this.body = `added ${this.params.task_id} to queue`;
});

setInterval(() => {
    log.info({
        event: 'queuePeriodic',
        lengths: {
            high: remeshQueuePriorities.high.length,
            low: remeshQueuePriorities.low.length
        },
        processingCount: currentProcessingCount,
        activeTasks: activeTasks,
        queue: {
            high: remeshQueuePriorities.high.map((reqParams) => reqParams.task_id),
            low: remeshQueuePriorities.low.map((reqParams) => reqParams.task_id)
        }
    });
}, 30000);
