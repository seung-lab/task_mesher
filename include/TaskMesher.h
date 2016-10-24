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
  std::vector<T>                    volume_;
  bool                              meshed_;
  const zi::vl::vec<size_t, 3>      dim_;
  std::set<T>                       segments_;


  size_t                            meshLength_[5];
  char                            * meshData_[5];

  inline void idxToXYZ(size_t idx, size_t &x, size_t &y, size_t &z) const;

  void selectSegmentsFillHoles();
  void selectSegmentsLeaveHoles();
  void selectSegments(bool fillHoles = false);


public:
  static const char * empty_mesh;
  bool GetMesh(uint8_t lod, const char ** data, size_t * length) const;

  CTaskMesher(std::vector<T> segmentation, const zi::vl::vec<size_t, 3> & dim, const std::vector<T> & segments);
  ~CTaskMesher();

};

typedef struct TaskMeshHandle TMesher;

#ifdef __cplusplus
extern "C" {
#endif
  TMesher * TaskMesher_Generate_uint8(unsigned char * volume, size_t dim[3], uint8_t * segments, uint8_t segmentCount);
  TMesher * TaskMesher_Generate_uint16(unsigned char * volume, size_t dim[3], uint16_t * segments, uint16_t segmentCount);
  TMesher * TaskMesher_Generate_uint32(unsigned char * volume, size_t dim[3], uint32_t * segments, uint32_t segmentCount);
  void      TaskMesher_Release_uint8(TMesher * taskmesher);
  void      TaskMesher_Release_uint16(TMesher * taskmesher);
  void      TaskMesher_Release_uint32(TMesher * taskmesher);
  void      TaskMesher_GetRawMesh_uint8(TMesher * taskmesher, const char ** data, size_t * length);
  void      TaskMesher_GetRawMesh_uint16(TMesher * taskmesher, const char ** data, size_t * length);
  void      TaskMesher_GetRawMesh_uint32(TMesher * taskmesher, const char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint8(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint16(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length);
  void      TaskMesher_GetSimplifiedMesh_uint32(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length);
#ifdef __cplusplus
} // extern "C"
#endif


#include "TaskMesher_Impl.h"


#endif