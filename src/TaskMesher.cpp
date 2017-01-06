#include "TaskMesher.h"

/*****************************************************************/

extern "C" TMesher * TaskMesher_Generate_uint8(unsigned char * volume, size_t dim[3], uint8_t * segments, uint8_t segmentCount, uint8_t mipCount) {
  std::vector<uint8_t> seg(segments, segments + segmentCount);
  std::vector<uint8_t> vol((uint8_t *)volume, (uint8_t *)volume + dim[0]*dim[1]*dim[2]);
  return (TMesher *)(new CTaskMesher<uint8_t>(std::move(vol), zi::vl::vec<size_t, 3>(dim[0], dim[1], dim[2]), seg, mipCount));
}

extern "C" TMesher * TaskMesher_Generate_uint16(unsigned char * volume, size_t dim[3], uint16_t * segments, uint16_t segmentCount, uint8_t mipCount) {
  std::vector<uint16_t> seg(segments, segments + segmentCount);
  std::vector<uint16_t> vol((uint16_t *)volume, (uint16_t *)volume + dim[0]*dim[1]*dim[2]);
  return (TMesher *)(new CTaskMesher<uint16_t>(std::move(vol), zi::vl::vec<size_t, 3>(dim[0], dim[1], dim[2]), seg, mipCount));
}

extern "C" TMesher * TaskMesher_Generate_uint32(unsigned char * volume, size_t dim[3], uint32_t * segments, uint32_t segmentCount, uint8_t mipCount) {
  std::vector<uint32_t> seg(segments, segments + segmentCount);
  std::vector<uint32_t> vol((uint32_t *)volume, (uint32_t *)volume + dim[0]*dim[1]*dim[2]);
  return (TMesher *)(new CTaskMesher<uint32_t>(std::move(vol), zi::vl::vec<size_t, 3>(dim[0], dim[1], dim[2]), seg, mipCount));
}

/*****************************************************************/

extern "C" void TaskMesher_Release_uint8(TMesher * taskmesher) {
  delete (CTaskMesher<uint8_t>*)(taskmesher);
}

extern "C" void TaskMesher_Release_uint16(TMesher * taskmesher) {
  delete (CTaskMesher<uint16_t>*)(taskmesher);
}

extern "C" void TaskMesher_Release_uint32(TMesher * taskmesher) {
  delete (CTaskMesher<uint32_t>*)(taskmesher);
}

/*****************************************************************/

extern "C" void TaskMesher_GetRawMesh_uint8(TMesher * taskmesher, const char ** data, size_t * length)
{
  ((CTaskMesher<uint8_t>*)(taskmesher))->GetMesh(0, data, length);
}

extern "C" void TaskMesher_GetRawMesh_uint16(TMesher * taskmesher, const char ** data, size_t * length)
{
  ((CTaskMesher<uint16_t>*)(taskmesher))->GetMesh(0, data, length);
}

extern "C" void TaskMesher_GetRawMesh_uint32(TMesher * taskmesher, const char ** data, size_t * length)
{
  ((CTaskMesher<uint32_t>*)(taskmesher))->GetMesh(0, data, length);
}

/*****************************************************************/

extern "C" void TaskMesher_GetSimplifiedMesh_uint8(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length)
{
  ((CTaskMesher<uint8_t>*)(taskmesher))->GetMesh(1 + lod, data, length);
}

extern "C" void TaskMesher_GetSimplifiedMesh_uint16(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length)
{
  ((CTaskMesher<uint16_t>*)(taskmesher))->GetMesh(1 + lod, data, length);
}

extern "C" void TaskMesher_GetSimplifiedMesh_uint32(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length)
{
  ((CTaskMesher<uint32_t>*)(taskmesher))->GetMesh(1 + lod, data, length);
}

/*****************************************************************/

extern "C" void TaskMesher_ScaleVolume_uint8(unsigned char * in_volume, size_t from_dim[3], size_t to_dim[3], unsigned char * out_buffer) {
  ScaleVolume((uint8_t*)in_volume, from_dim, to_dim, (uint8_t*)out_buffer);
}

extern "C" void TaskMesher_ScaleVolume_uint16(unsigned char * in_volume, size_t from_dim[3], size_t to_dim[3], unsigned char * out_buffer) {
  ScaleVolume((uint16_t*)in_volume, from_dim, to_dim, (uint16_t*)out_buffer);
}

extern "C" void TaskMesher_ScaleVolume_uint32(unsigned char * in_volume, size_t from_dim[3], size_t to_dim[3], unsigned char * out_buffer) {
  ScaleVolume((uint32_t*)in_volume, from_dim, to_dim, (uint32_t*)out_buffer);
}

/*****************************************************************/

extern "C" void TaskMesher_ScaleMesh_uint8(TMesher * taskmesher, float scaleFactor[3])
{
  ((CTaskMesher<uint8_t>*)(taskmesher))->ScaleMesh(scaleFactor);
}

extern "C" void TaskMesher_ScaleMesh_uint16(TMesher * taskmesher, float scaleFactor[3])
{
  ((CTaskMesher<uint16_t>*)(taskmesher))->ScaleMesh(scaleFactor);
}

extern "C" void TaskMesher_ScaleMesh_uint32(TMesher * taskmesher, float scaleFactor[3])
{
  ((CTaskMesher<uint32_t>*)(taskmesher))->ScaleMesh(scaleFactor);
}

/*****************************************************************/