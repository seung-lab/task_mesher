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


  size_t                            meshLength_[5];
  char                            * meshData_[5];
  //std::array<std::vector<float>, 5> meshes_;


  inline void idxToXYZ(size_t idx, size_t &x, size_t &y, size_t &z) const;

  void selectSegmentsFillHoles();
  void selectSegmentsLeaveHoles();
  void selectSegments(bool fillHoles = false);


public:
  static const char * empty_mesh;
  bool GetMesh(uint8_t lod, const char ** data, size_t * length) const;

  CTaskMesher(const std::string & segmentation_path, const zi::vl::vec<size_t, 3> & dim, const std::vector<T> & segments, const std::string & write_path);
  ~CTaskMesher();

};

typedef struct TaskMeshHandle TMesher;

#ifdef __cplusplus
extern "C" {
#endif
  TMesher * TaskMesher_Generate_uint8(char * segmentation_path, size_t dim[3], uint8_t segmentCount, uint8_t * segments, char * write_path);
  TMesher * TaskMesher_Generate_uint16(char * segmentation_path, size_t dim[3], uint16_t segmentCount, uint16_t * segments, char * write_path);
  TMesher * TaskMesher_Generate_uint32(char * segmentation_path, size_t dim[3], uint32_t segmentCount, uint32_t * segments, char * write_path);
  TMesher * TaskMesher_Generate_uint64(char * segmentation_path, size_t dim[3], uint64_t segmentCount, uint64_t * segments, char * write_path);
  void      TaskMesher_Release_uint8(TMesher * taskmesher);
  void      TaskMesher_Release_uint16(TMesher * taskmesher);
  void      TaskMesher_Release_uint32(TMesher * taskmesher);
  void      TaskMesher_Release_uint64(TMesher * taskmesher);
  void      TaskMesher_GetRawMesh_uint8(TMesher * taskmesher, const char ** data, size_t * length);
  void      TaskMesher_GetRawMesh_uint16(TMesher * taskmesher, const char ** data, size_t * length);
  void      TaskMesher_GetRawMesh_uint32(TMesher * taskmesher, const char ** data, size_t * length);
  void      TaskMesher_GetRawMesh_uint64(TMesher * taskmesher, const char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint8(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint16(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint32(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint64(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length);
#ifdef __cplusplus
} // extern "C"
#endif




#endif