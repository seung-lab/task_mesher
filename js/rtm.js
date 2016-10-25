// Packages
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

const NodeRedis  = require('redis');           // cache for volume data (metadata, segment bboxes and sizes, segmentation)
const redis = NodeRedis.createClient('6379', '127.0.0.1', {return_buffers: true});
const log = require('./logging.js').log;

Promise.promisifyAll(NodeRedis.RedisClient.prototype);
Promise.promisifyAll(NodeRedis.Multi.prototype);

lzma.setPromiseAPI(Promise);

// Typedefs
const TaskMesherPtr = ref.refType(ref.types.void);
const SizeTArray = ArrayType(ref.types.size_t);
const UInt8Ptr = ref.refType(ref.types.uint8);
const UInt16Ptr = ref.refType(ref.types.uint16);
const UInt32Ptr = ref.refType(ref.types.uint32);
const SizeTPtr = ref.refType(ref.types.size_t);
const UCharPtr = ref.refType(ref.types.uchar);
const CharPtr = ref.refType(ref.types.char);
const CharPtrPtr = ref.refType(ref.types.CString);

const TaskMesherLib = ffi.Library('../lib/librtm', {
    // TMesher * TaskMesher_Generate_uint8(unsigned char * volume, size_t byteLength, size_t dim[3], uint8_t * segments, uint8_t segmentCount);  
    "TaskMesher_Generate_uint8": [ TaskMesherPtr, [ UCharPtr, SizeTArray, UInt8Ptr, "uint8" ] ],
    "TaskMesher_Generate_uint16": [ TaskMesherPtr, [ UCharPtr, SizeTArray, UInt16Ptr, "uint16" ] ],
    "TaskMesher_Generate_uint32": [ TaskMesherPtr, [ UCharPtr, SizeTArray, UInt32Ptr, "uint32" ] ],

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
});

const typeLookup = {
    uint8: {
        constructor: Uint8Array,
        generate: TaskMesherLib.TaskMesher_Generate_uint8,
        release: TaskMesherLib.TaskMesher_Release_uint8,
        getRawMesh: TaskMesherLib.TaskMesher_GetRawMesh_uint8,
        getSimplifiedMesh: TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint8
    },
    uint16: {
        constructor: Uint16Array,
        generate: TaskMesherLib.TaskMesher_Generate_uint16,
        release: TaskMesherLib.TaskMesher_Release_uint16,
        getRawMesh: TaskMesherLib.TaskMesher_GetRawMesh_uint16,
        getSimplifiedMesh: TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint16
    },
    uint32: {
        constructor: Uint32Array,
        generate: TaskMesherLib.TaskMesher_Generate_uint32,
        release: TaskMesherLib.TaskMesher_Release_uint32,
        getRawMesh: TaskMesherLib.TaskMesher_GetRawMesh_uint32,
        getSimplifiedMesh: TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint32
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

function generateMeshes(segmentation_path, dimensions, segments, intType) {
    return new Promise((fulfill, reject) => {
        return cachedFetch({ url: segmentation_path + 'segmentation.lzma', encoding: null })
        .then(function(segmentation) {
            const segmentsTA = new intType.constructor(segments);
            const segmentsBuffer = Buffer.from(segmentsTA.buffer);
            segmentsBuffer.type = ref.types[intType];

            const dimensionsArray = new SizeTArray(3);
            dimensionsArray[0] = dimensions.x;
            dimensionsArray[1] = dimensions.y;
            dimensionsArray[2] = dimensions.z;

            intType.generate.async(segmentation, dimensionsArray, segmentsBuffer, segmentsTA.length, function (err, mesher) {
                if (err) reject(err);
                else fulfill(mesher);
            });
        })
        .catch(function (err) {
            reject(err);
        });
    });
}

const MIP_COUNT = 4;
const writeBucket = gcs.bucket('overview_meshes');

const syncMap = new Map();
let processCount = 0;

function processRemesh(params) {
    return new Promise((fulfill, reject) => {
        const start = Date.now();
        const {task_id, cell_id, type, task_dim, bucket, path, segments} = params;
        console.log("Remeshing task " + task_id);

        const segmentation_path = `https://storage.googleapis.com/${bucket}/${path}`;
        const intType = typeLookup[type];

        const processId = processCount++;
        syncMap.set(task_id, processId);

        generateMeshes(segmentation_path, task_dim, segments, intType).then((mesher) => {
            if (syncMap.get(task_id) !== processId) {
                console.log('aborted save, not newest mesh', task_id, processId, syncMap.get(task_id));
                fulfill();
            }
            syncMap.delete(task_id);

            let remaining = MIP_COUNT;
            for (let lod = 0; lod < MIP_COUNT; ++lod) {
                const lengthPtr = ref.alloc(ref.types.size_t);
                const dataPtr = ref.alloc(CharPtr);
                intType.getSimplifiedMesh(mesher, lod, dataPtr, lengthPtr);//, function (err) { DISABLED ASYNC DUE TO TIMING ISSUE

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
                wstream.on('error', function(e) { console.error(e); });
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

const MAX_PROCESSING_COUNT = process.env.THREADS || 4;
let currentProcessingCount = 0;
const remeshQueuePriorities = {
    high: [],
    low: []
};

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
        const reqParams = remeshQueue.shift();
        currentProcessingCount++;
        const start = Date.now();
        processRemesh(reqParams).then(() => {
            console.log('time', reqParams.task_id, Date.now() - start);
            rp({
                method: 'POST',
                uri: `http://nkem.eyewire.org/1.0/task/${reqParams.task_id}/mesh_updated/`
            }).then(() => {
                console.log('sent', reqParams.task_id, 'to site server');
            }).catch((err) => {
                console.log('failed to send mesh_update', err); // no big deal if this fails?
            });
            currentProcessingCount--;
            checkRemeshQueue();
        }).catch((err) => {
            log.error({
                event: 'processRemesh',
				err: err,
				params: reqParams
			});
            currentProcessingCount--;
            checkRemeshQueue();
        });
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
        priority: ['high', 'low']
    }, function* () {
        if (this.params.priority === 'high') {
            remeshQueuePriorities.low = remeshQueuePriorities.low.filter((oParams) => {
                return oParams.task_id !== this.params.task_id;
            });
        }
        remeshQueuePriorities[this.params.priority].push(this.params);
        if (currentProcessingCount < MAX_PROCESSING_COUNT) checkRemeshQueue();
        else console.log('busy');
        this.body = `added ${this.params.task_id} to queue`;
});
