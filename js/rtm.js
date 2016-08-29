// Packages
var ref        = require('ref');
var ffi        = require('ffi');
var ArrayType  = require('ref-array');
var fs         = require('fs');
var express    = require('express');
var app        = express();
var bodyParser = require('body-parser');
var mkdirp     = require('mkdirp');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

//var router = express.Router();

// Typedefs
var TaskMesherPtr = ref.refType(ref.types.void);
var SizeTArray = ArrayType(ref.types.size_t);
var UInt8Ptr = ref.refType(ref.types.uint8);
var UInt16Ptr = ref.refType(ref.types.uint16);
var UInt32Ptr = ref.refType(ref.types.uint32);
var UInt64Ptr = ref.refType(ref.types.uint64);
var SizeTPtr = ref.refType(ref.types.size_t);
var CharPtr = ref.refType(ref.types.char);
var CharPtrPtr = ref.refType(ref.types.CString);

var TaskMesherLib = ffi.Library('../lib/librtm', {
  // TMesher * TaskMesher_Generate_uint8(char * url, size_t dim[3], uint8_t segmentCount, uint8_t * segments);  
  "TaskMesher_Generate_uint8": [ TaskMesherPtr, [ "string", SizeTArray, "uint8", UInt8Ptr ] ],
  "TaskMesher_Generate_uint16": [ TaskMesherPtr, [ "string", SizeTArray, "uint16", UInt16Ptr ] ],
  "TaskMesher_Generate_uint32": [ TaskMesherPtr, [ "string", SizeTArray, "uint32", UInt32Ptr ] ],
  "TaskMesher_Generate_uint64": [ TaskMesherPtr, [ "string", SizeTArray, "uint64", UInt64Ptr ] ],

  // void      TaskMesher_Release_uint8(TMesher * taskmesher);
  "TaskMesher_Release_uint8": [ "void", [ TaskMesherPtr ] ],
  "TaskMesher_Release_uint16": [ "void", [ TaskMesherPtr ] ],
  "TaskMesher_Release_uint32": [ "void", [ TaskMesherPtr ] ],
  "TaskMesher_Release_uint64": [ "void", [ TaskMesherPtr ] ],

  // void      TaskMesher_GetRawMesh_uint8(TMesher * taskmesher, char ** data, size_t * length);
  "TaskMesher_GetRawMesh_uint8": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetRawMesh_uint16": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetRawMesh_uint32": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetRawMesh_uint64": [ "void", [ TaskMesherPtr, CharPtrPtr, SizeTPtr ] ],

  //void      TaskMesher_GetSimplifiedMesh_uint8(TMesher * taskmesher, uint8_t lod, char ** data, size_t * length);
  "TaskMesher_GetSimplifiedMesh_uint8": [ "void", [ TaskMesherPtr , "uint8", CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetSimplifiedMesh_uint16": [ "void", [ TaskMesherPtr , "uint8", CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetSimplifiedMesh_uint32": [ "void", [ TaskMesherPtr , "uint8", CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetSimplifiedMesh_uint64": [ "void", [ TaskMesherPtr , "uint8", CharPtrPtr, SizeTPtr ] ],
});

app.get('/cell/:cellId/task/:taskId', function(req, res) {
    var lod = req.query.lod || 1;
    console.log("Get LOD " + lod + " for task " + req.params.taskId + "\n");
    console.time("Get LOD " + lod + " for task " + req.params.taskId);

    var options = { root: __dirname }
    res.sendFile("./meshes/" + req.params.cellId + "/" + req.params.taskId + "/" + lod + ".dstrip", options, function (err) {
        if (err) {
            console.log(err);
            res.status(err.status).end();
        }
        else {
            console.timeEnd("Get LOD " + lod + " for task " + req.params.taskId);
        }
    });

});

app.post('/cell/:cellId/task/:taskId', function(req, res) {
    console.log("Remeshing task " + req.params.taskId + "\n");
    console.time("Remeshing task " + req.params.taskId);
    var segmentation_url = "https://storage.googleapis.com/" + req.body.bucket + "/" + req.body.volumeId + ".segmentation.lzma"
    //var segmentation_url = req.body.segmentation_url; // "https://storage.googleapis.com/zebrafish_web_4x4x4/153742.segmentation.lzma"

    var dimensions = new SizeTArray(3);
    console.log(req.body);
    dimensions[0] = req.body.task_dim_x;
    dimensions[1] = req.body.task_dim_y;
    dimensions[2] = req.body.task_dim_z;

    switch (req.body.type) {
        case "uint8":
            var segments = new Uint8Array(req.body.segments);
            var seg = Buffer.from(segments.buffer);
            seg.type = ref.types.uint8;

            var mesher = TaskMesherLib.TaskMesher_Generate_uint8(segmentation_url, dimensions, segments.length, seg);

            for (var lod = 0; lod < 4; ++lod) {
                var lengthPtr = ref.alloc(ref.types.size_t);
                var dataPtr = ref.alloc(CharPtr);
                TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint8(mesher, lod, dataPtr, lengthPtr);
                var len = lengthPtr.deref();
                var data = ref.reinterpret(dataPtr.deref(), len);

                var buf = new Buffer(data.length);
                data.copy(buf, 0, 0, data.length); // Without this nonsense I get { [Error: EFAULT: bad address in system call argument, write] errno: -14, code: 'EFAULT', syscall: 'write' }

                mkdirp("./meshes/" + req.params.cellId + "/" + req.params.taskId, function (err) {
                    if (err) { console.error(err); }
                    else {
                        var wstream = fs.createWriteStream("./meshes/" + req.params.cellId + "/" + req.params.taskId + "/" + lod + ".dstrip", {defaultEncoding: 'binary'});
                        wstream.on('error', function(e) { console.error(e); });
                        wstream.write(buf);
                        wstream.end();
                    }
                });
               
            }

            TaskMesherLib.TaskMesher_Release_uint8(mesher);

            break;

        case "uint16":
            var segments = new Uint16Array(req.body.segments);
            var seg = Buffer.from(segments.buffer);
            seg.type = ref.types.uint16;
            var mesher = TaskMesherLib.TaskMesher_Generate_uint16(segmentation_url, dimensions, segments.length, seg);

            for (var lod = 0; lod < 4; ++lod) {
                var lengthPtr = ref.alloc(ref.types.size_t);
                var dataPtr = ref.alloc(CharPtr);
                TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint16(mesher, lod, dataPtr, lengthPtr);
                var len = lengthPtr.deref();
                var data = ref.reinterpret(dataPtr.deref(), len); 

                var buf = new Buffer(data.length);
                data.copy(buf, 0, 0, data.length); // Without this nonsense I get { [Error: EFAULT: bad address in system call argument, write] errno: -14, code: 'EFAULT', syscall: 'write' }

                mkdirp("./meshes/" + req.params.cellId + "/" + req.params.taskId, function (err) {
                    if (err) { console.error(err); }
                    else {
                        var wstream = fs.createWriteStream("./meshes/" + req.params.cellId + "/" + req.params.taskId + "/" + lod + ".dstrip", {defaultEncoding: 'binary'});
                        wstream.on('error', function(e) { console.error(e); });
                        wstream.write(buf);
                        wstream.end();
                    }
                });
            }

            TaskMesherLib.TaskMesher_Release_uint16(mesher);

            break;

        case "uint32":
            var segments = new Uint32Array(req.body.segments);
            var seg = Buffer.from(segments.buffer);
            seg.type = ref.types.uint32;
            var mesher = TaskMesherLib.TaskMesher_Generate_uint32(segmentation_url, dimensions, segments.length, seg);

            for (var lod = 0; lod < 4; ++lod) {
                var lengthPtr = ref.alloc(ref.types.size_t);
                var dataPtr = ref.alloc(CharPtr);
                TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint32(mesher, lod, dataPtr, lengthPtr);
                var len = lengthPtr.deref();
                var data = ref.reinterpret(dataPtr.deref(), len);

                var buf = new Buffer(data.length);
                data.copy(buf, 0, 0, data.length); // Without this nonsense I get { [Error: EFAULT: bad address in system call argument, write] errno: -14, code: 'EFAULT', syscall: 'write' }

                mkdirp("./meshes/" + req.params.cellId + "/" + req.params.taskId, function (err) {
                    if (err) { console.error(err); }
                    else {
                        var wstream = fs.createWriteStream("./meshes/" + req.params.cellId + "/" + req.params.taskId + "/" + lod + ".dstrip", {defaultEncoding: 'binary'});
                        wstream.on('error', function(e) { console.error(e); });
                        wstream.write(buf);
                        wstream.end();
                    }
                });
            }

            TaskMesherLib.TaskMesher_Release_uint32(mesher);

            break;

        case "uint64":
            var segments = new Uint64Array(req.body.segments);
            var seg = Buffer.from(segments.buffer);
            seg.type = ref.types.uint64;
            var mesher = TaskMesherLib.TaskMesher_Generate_uint64(segmentation_url, dimensions, segments.length, seg);

            for (var lod = 0; lod < 4; ++lod) {
                var lengthPtr = ref.alloc(ref.types.size_t);
                var dataPtr = ref.alloc(CharPtr);
                TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint64(mesher, lod, dataPtr, lengthPtr);
                var len = lengthPtr.deref();
                var data = ref.reinterpret(dataPtr.deref(), len);

                var buf = new Buffer(data.length);
                data.copy(buf, 0, 0, data.length); // Without this nonsense I get { [Error: EFAULT: bad address in system call argument, write] errno: -14, code: 'EFAULT', syscall: 'write' }

                mkdirp("./meshes/" + req.params.cellId + "/" + req.params.taskId, function (err) {
                    if (err) { console.error(err); }
                    else {
                        var wstream = fs.createWriteStream("./meshes/" + req.params.cellId + "/" + req.params.taskId + "/" + lod + ".dstrip", {defaultEncoding: 'binary'});
                        wstream.on('error', function(e) { console.error(e); });
                        wstream.write(buf);
                        wstream.end();
                    }
                });
            }

            TaskMesherLib.TaskMesher_Release_uint64(mesher);

            break;
    }
    console.timeEnd("Remeshing task " + req.params.taskId);
    res.sendStatus(204);
});

module.exports = app;