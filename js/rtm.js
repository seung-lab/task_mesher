var ref = require('ref');
var ffi = require('ffi');
var ArrayType = require('ref-array');
var fs = require('fs');

// typedefs
var TaskMesher = ref.types.void;

var SizeTArray = ArrayType(ref.types.size_t);

var UInt8Ptr = ref.refType(ref.types.uint8);
var UInt16Ptr = ref.refType(ref.types.uint16);
var UInt32Ptr = ref.refType(ref.types.uint32);
var UInt64Ptr = ref.refType(ref.types.uint64);

var SizeTPtr = ref.refType('size_t');
var CharPtrPtr = ref.refType('char *');

var TaskMesherLib = ffi.Library('/usr/people/nkemnitz/src/rtm/nkem/librtm', {
  // TMesher * TaskMesher_Generate_uint8(char * url, size_t dim[3], uint8_t segmentCount, uint8_t * segments);  
  "TaskMesher_Generate_uint8": [ "pointer", [ "string", SizeTArray, "uint8", UInt8Ptr ] ],
  "TaskMesher_Generate_uint16": [ "pointer", [ "string", SizeTArray, "uint16", UInt16Ptr ] ],
  "TaskMesher_Generate_uint32": [ "pointer", [ "string", SizeTArray, "uint32", UInt32Ptr ] ],
  "TaskMesher_Generate_uint64": [ "pointer", [ "string", SizeTArray, "uint64", UInt64Ptr ] ],

  // void      TaskMesher_Release_uint8(TMesher * taskmesher);
  "TaskMesher_Release_uint8": [ "void", [ "pointer" ] ],
  "TaskMesher_Release_uint16": [ "void", [ "pointer" ] ],
  "TaskMesher_Release_uint32": [ "void", [ "pointer" ] ],
  "TaskMesher_Release_uint64": [ "void", [ "pointer" ] ],

  // void      TaskMesher_GetRawMesh_uint8(TMesher * taskmesher, char ** data, size_t * length);
  "TaskMesher_GetRawMesh_uint8": [ "void", [ "pointer", CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetRawMesh_uint16": [ "void", [ "pointer", CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetRawMesh_uint32": [ "void", [ "pointer", CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetRawMesh_uint64": [ "void", [ "pointer", CharPtrPtr, SizeTPtr ] ],

  //void      TaskMesher_GetSimplifiedMesh_uint8(TMesher * taskmesher, uint8_t lod, char ** data, size_t * length);
  "TaskMesher_GetSimplifiedMesh_uint8": [ "void", [ "pointer" , "uint8", CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetSimplifiedMesh_uint16": [ "void", [ "pointer" , "uint8", CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetSimplifiedMesh_uint32": [ "void", [ "pointer" , "uint8", CharPtrPtr, SizeTPtr ] ],
  "TaskMesher_GetSimplifiedMesh_uint64": [ "void", [ "pointer" , "uint8", CharPtrPtr, SizeTPtr ] ],
});


var dimensions = new SizeTArray(3);
dimensions[0] = 1024;
dimensions[1] = 1024;
dimensions[2] = 128;


var segments = new Uint16Array([5547, 6700, 7105, 7046, 7369, 7300, 7375, 7305, 7606, 7297, 7295, 7230, 7307, 7039, 7107, 7102,
                               7021, 6766, 6895, 6907, 7043, 7120, 7177, 7050, 6980, 6785, 6380, 7411, 7474, 7573, 7711, 7813,
                               7060, 7134, 6659, 7131, 4012, 3957, 7619, 6527]);
var seg = Buffer.from(segments.buffer);
seg.type = ref.types.uint16;


console.log("Running TaskMesher_Generate_uint16!\n");
var mesher = TaskMesherLib.TaskMesher_Generate_uint16("https://storage.googleapis.com/zebrafish_web_4x4x4/153742.segmentation.lzma", dimensions, segments.length, segments);
if (mesher.isNull()) {
    console.log("Could not create TaskMesher Object!\n");
} else {
    console.log("Successfully created TaskMesher Object!\n");
    var lengthPtr = ref.alloc('size_t');
    var dataPtr = ref.alloc('char *');
    TaskMesherLib.TaskMesher_GetSimplifiedMesh_uint16(mesher, 1, dataPtr, lengthPtr);
    var len = lengthPtr.deref();
    var data = ref.reinterpret(dataPtr.deref(), len);
    data = data.toString();

    var wstream = fs.createWriteStream('node-rtm.bin');
    wstream.write(data);
    wstream.end();

    TaskMesherLib.TaskMesher_Release_uint16(mesher);
}