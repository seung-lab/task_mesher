#pragma once

#ifndef TASK_MESHER_H
#define TASK_MESHER_H

#include <string>
#include <vector>
#include <set>
#include <zi/vl/vec.hpp>

template<typename T>
class CTaskMesher {
private:
  bool                              meshed_;
  std::vector<unsigned char>        buffer_;
  T                               * volume_; // T * dim.x * dim.y * dim.z;
  const zi::vl::vec<size_t, 3>      dim_;
  std::set<T>                       segments_;

  std::array<std::vector<float>, 5> meshes_;


  inline void idxToXYZ(size_t idx, size_t &x, size_t &y, size_t &z) const;

  void selectSegmentsFillHoles();
  void selectSegmentsLeaveHoles();
  void selectSegments(bool fillHoles = false);


public:
  const std::vector<float> & GetMesh(uint8_t lod) const;

  CTaskMesher(const std::string & url, const zi::vl::vec<size_t, 3> & dim, const std::vector<T> & segments);
  ~CTaskMesher();

};

typedef struct TaskMeshHandle TMesher;

#ifdef __cplusplus
extern "C" {
#endif
  TMesher * TaskMesher_Generate_uint8(char * url, size_t dim[3], uint8_t segmentCount, uint8_t * segments);
  TMesher * TaskMesher_Generate_uint16(char * url, size_t dim[3], uint16_t segmentCount, uint16_t * segments);
  TMesher * TaskMesher_Generate_uint32(char * url, size_t dim[3], uint32_t segmentCount, uint32_t * segments);
  TMesher * TaskMesher_Generate_uint64(char * url, size_t dim[3], uint64_t segmentCount, uint64_t * segments);
  void      TaskMesher_Release_uint8(TMesher * taskmesher);
  void      TaskMesher_Release_uint16(TMesher * taskmesher);
  void      TaskMesher_Release_uint32(TMesher * taskmesher);
  void      TaskMesher_Release_uint64(TMesher * taskmesher);
  void      TaskMesher_GetRawMesh_uint8(TMesher * taskmesher, char ** data, size_t * length);
  void      TaskMesher_GetRawMesh_uint16(TMesher * taskmesher, char ** data, size_t * length);
  void      TaskMesher_GetRawMesh_uint32(TMesher * taskmesher, char ** data, size_t * length);
  void      TaskMesher_GetRawMesh_uint64(TMesher * taskmesher, char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint8(TMesher * taskmesher, uint8_t lod, char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint16(TMesher * taskmesher, uint8_t lod, char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint32(TMesher * taskmesher, uint8_t lod, char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint64(TMesher * taskmesher, uint8_t lod, char ** data, size_t * length);
#ifdef __cplusplus
} // extern "C"
#endif




#endif