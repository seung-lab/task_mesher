// Packages
let app = module.exports = require('./mykoa.js')();
let ref        = require('ref');
let ffi        = require('ffi');
let ArrayType  = require('ref-array');
let fs         = require('fs');
let mkdirp     = require('mkdirp');
let send = require('koa-send');

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
  "TaskMesher_Generate_uint8": [ TaskMesherPtr, [ "string", SizeTArray, "uint8", UInt8Ptr ] ],
  "TaskMesher_Generate_uint16": [ TaskMesherPtr, [ "string", SizeTArray, "uint16", UInt16Ptr ] ],
  "TaskMesher_Generate_uint32": [ TaskMesherPtr, [ "string", SizeTArray, "uint32", UInt32Ptr ] ],

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

app.post('/getmesh', null, {
        lod: { type: 'int', min: 0 },
        cell_id: { type: 'int', min: 0},
        task_id: { type: 'int', min: 0}
    }, function* () {
    let {lod, task_id, cell_id} = this.params;
    console.log("Get LOD " + lod + " for task " + task_id + "\n");
    console.time("Get LOD " + lod + " for task " + task_id);

    let options = { root: __dirname };

    let path = yield send(this, `./meshes/${cell_id}/${task_id}/${lod}.dstrip`, options);

    if (!path) {

    }
});

app.post('/remesh', null, {
        cell_id: { type: 'int', min: 0},
        task_id: { type: 'int', min: 0},
        volume_id: { type: 'int', min: 0},
        type: { type: 'string'},
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
        let {task_id, cell_id, type, task_dim, bucket, volume_id, segments} = this.params;
    console.log("Remeshing task " + task_id);
    console.time("Remeshing task " + task_id);
    let segmentation_url = `https://storage.googleapis.com/${bucket}/${volume_id}.segmentation.lzma`;

    let dimensions = new SizeTArray(3);
    dimensions[0] = task_dim.x;
    dimensions[1] = task_dim.y;
    dimensions[2] = task_dim.z; 

    switch (type) {
        case "uint8":
        case "uint16":
        case "uint32":
            let intType = typeLookup[type];
            let segmentsTA = new intType.constructor(segments);
            let seg = Buffer.from(segmentsTA.buffer);
            seg.type = ref.types[intType];

            intType.generate.async(segmentation_url, dimensions, segmentsTA.length, seg, function (err, mesher) {
               for (let lod = 0; lod < 4; ++lod) {
                    let lengthPtr = ref.alloc(ref.types.size_t);
                    let dataPtr = ref.alloc(CharPtr);
                    intType.getSimplifiedMesh.async(mesher, lod, dataPtr, lengthPtr, function (err) {
                        if (err) console.log(err);

                        let len = lengthPtr.deref();
                        let data = ref.reinterpret(dataPtr.deref(), len);

                        let buf = new Buffer(data.length);
                        data.copy(buf, 0, 0, data.length); // Without this nonsense I get { [Error: EFAULT: bad address in system call argument, write] errno: -14, code: 'EFAULT', syscall: 'write' }

                        mkdirp(`./meshes/${cell_id}/${task_id}`, function (err) {
                            if (err) { console.error(err); }
                            else {
                                let wstream = fs.createWriteStream(`./meshes/${cell_id}/${task_id}/${lod}.dstrip`, {defaultEncoding: 'binary'});
                                wstream.on('error', function(e) { console.error(e); });
                                wstream.write(buf);
                                wstream.end();
                            }
                        });

                    });
                }

                intType.release(mesher);
            });

            break;
   }
    console.timeEnd("Remeshing task " + task_id);
    this.body = `meshing ${task_id}`;
});
