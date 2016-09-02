// Packages
let app = module.exports = require('./mykoa.js')();
let ref        = require('ref');
let ffi        = require('ffi');
let ArrayType  = require('ref-array');
let fs         = require('fs');
let mkdirp     = require('mkdirp');
let send       = require('koa-send');
let rp         = require('request-promise');

const WriteFolder = '/mnt/overview_meshes_bucket';

// Typedefs
let TaskMesherPtr = ref.refType(ref.types.void);
let SizeTArray = ArrayType(ref.types.size_t);
let UInt8Ptr = ref.refType(ref.types.uint8);
let UInt16Ptr = ref.refType(ref.types.uint16);
let UInt32Ptr = ref.refType(ref.types.uint32);
let SizeTPtr = ref.refType(ref.types.size_t);
let CharPtr = ref.refType(ref.types.char);
let CharPtrPtr = ref.refType(ref.types.CString);

let TaskMesherLib = ffi.Library('../lib/librtm', {
    // TMesher * TaskMesher_Generate_uint8(char * url, size_t dim[3], uint8_t segmentCount, uint8_t * segments);  
    "TaskMesher_Generate_uint8": [ TaskMesherPtr, [ "string", SizeTArray, "uint8", UInt8Ptr, "string" ] ],
    "TaskMesher_Generate_uint16": [ TaskMesherPtr, [ "string", SizeTArray, "uint16", UInt16Ptr, "string" ] ],
    "TaskMesher_Generate_uint32": [ TaskMesherPtr, [ "string", SizeTArray, "uint32", UInt32Ptr, "string" ] ],

    // void      TaskMesher_Release_uint8(TMesher * taskmesher);
    "TaskMesher_Release_uint8": [ "void", [ TaskMesherPtr ] ],
    "TaskMesher_Release_uint16": [ "void", [ TaskMesherPtr ] ],
    "TaskMesher_Release_uint32": [ "void", [ TaskMesherPtr ] ],

    // void      TaskMesher_GetRawMesh_uint8(TMesher * taskmesher, char ** data, size_t * length);
    "TaskMesher_GetRawMesh_uint8": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],
    "TaskMesher_GetRawMesh_uint16": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],
    "TaskMesher_GetRawMesh_uint32": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],
});

let typeLookup = {
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

function generateMeshes(segmentation_path, dimensions, segments, intType, write_path) {
    return new Promise((fulfill, reject) => {
        let segmentsTA = new intType.constructor(segments);
        let segmentsBuffer = Buffer.from(segmentsTA.buffer);
        segmentsBuffer.type = ref.types[intType];

        let dimensionsArray = new SizeTArray(3);
        dimensionsArray[0] = dimensions.x;
        dimensionsArray[1] = dimensions.y;
        dimensionsArray[2] = dimensions.z;

        intType.generate.async(segmentation_path, dimensionsArray, segmentsTA.length, segmentsBuffer, write_path, function (err, mesher) {
            if (err) reject(err);
            else fulfill(mesher);
        });
    });
}

const MIP_COUNT = 4;

function processRemesh(params) {
    return new Promise((fulfill, reject) => {
        let start = Date.now();
        let {task_id, cell_id, type, task_dim, bucket, volume_id, segments} = params;

        let segmentation_path = `/mnt/${bucket}_bucket/${volume_id}.segmentation.lzma`;
        let intType = typeLookup[type];

        let write_path = `${WriteFolder}/meshes/${cell_id}/${task_id}/`;
        mkdirp(write_path, function (err) {
            if (err) { console.error(err); }
            else {
                generateMeshes(segmentation_path, task_dim, segments, intType, write_path).then((mesher) => {
                    intType.release(mesher);
                    fulfill();
                }).catch((err) => {
                    console.log('generateMeshes error', err, params); // this one shouldn't fail, need to do something
                });
            }
        });
    });
}

const MAX_PROCESSING_COUNT = process.env.THREADS || 4;
let currentProcessingCount = 0;
let remeshQueue = [];

function checkRemeshQueue() {
    console.log('queue length', remeshQueue.length, currentProcessingCount);
    if (remeshQueue.length > 0) {
        let reqParams = remeshQueue.shift();
        currentProcessingCount++;
        console.log('processing', reqParams.task_id);
        let start = Date.now();
        processRemesh(reqParams).then(() => {
            console.log('time', reqParams.task_id, Date.now() - start);
            rp({
                method: 'POST',
                uri: `http://beta.eyewire.org/1.0/task/${reqParams.task_id}/mesh_updated/`
            }).then(() => {
                console.log('sent', reqParams.task_id, 'to site server');
            }).catch((err) => {
                console.log('failed to send mesh_update', err); // no big deal if this fails?
            });
            currentProcessingCount--;
            checkRemeshQueue();
        }).catch((err) => console.log('processRemesh err', err));
    } else {
        console.log('queue empty');
    } 
}

app.post('/remesh', null, {
        cell_id: { type: 'int', min: 0},
        task_id: { type: 'int', min: 0},
        volume_id: { type: 'int', min: 0},
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
        segments: {
            type: 'array',
            itemType: 'int',
            rule: { min: 0 }
        }
    }, function* () {
//        console.log('got request');
        remeshQueue.push(this.params); // TODO, validate them more?
        if (currentProcessingCount < MAX_PROCESSING_COUNT) checkRemeshQueue();
//        else console.log('busy');
        this.body = `added ${this.params.task_id} to queue`;
//        console.log('done');
});

//setInterval(function () { console.log('not busy'); }, 1000);
