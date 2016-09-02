#include "TaskMesher.h"
#include "LZMADec.h"
#include "MeshIO.h"

#include <zi/mesh/marching_cubes.hpp>
#include <zi/mesh/int_mesh.hpp>
#include <zi/mesh/quadratic_simplifier.hpp>

#include <fstream>
#include <queue>
#include <iostream>
#include <iterator>

/*****************************************************************/
template<typename T>
const char * CTaskMesher<T>::empty_mesh = "";

template<typename T>
CTaskMesher<T>::CTaskMesher(const std::string & segmentation_path, const zi::vl::vec<size_t, 3> & dim, const std::vector<T> & segments, const std::string & write_path) :
meshed_(false), volume_(NULL), dim_(dim), segments_(segments.begin(), segments.end())
{
    for (int i = 0; i < 5; ++i) {
      meshData_[i] = NULL;
    }

    if (segments_.empty()) { // Shortcut for empty tasks
        meshed_ = true;
        return;
    }

    // 1. Load Segmentations
    std::vector<unsigned char> compressedBuf;

    std::ifstream segFile(segmentation_path, std::ios::in | std::ifstream::binary);

    if (!segFile) {
      std::cout << "Error opening file: " << segmentation_path << "\n";
      return;
    }

    std::istreambuf_iterator<char> iter(segFile);
    std::copy(iter,std::istreambuf_iterator<char>{},std::back_inserter(compressedBuf));

    segFile.close();

    // try {
    //     CCurlObject request(url);
    //     compressedBuf = request.getData();
    // }
    // catch (const std::string & e) {
    //     std::cerr << e;
    //     return;
    // }

    /*if (printDebug) {
        std::cout << "Downloaded segmentation data in: " << t.elapsed<double>() << " s.\n";
        t.reset();
    }*/

    // 2. Decompress LZMA stream;
    try {
        LZMADec dec(compressedBuf, sizeof(T) * dim_[0] * dim_[1] * dim_[2]);
        buffer_ = dec.getUncompressed();
    }
    catch (const std::string & e) {
        std::cerr << e;
        return;
    }

    /*if (printDebug) {
        std::cout << "Decompressed segmentation data in: " << t.elapsed<double>() << " s.\n";
        t.reset();
    }*/

    volume_ = reinterpret_cast<T*>(&buffer_[0]);


    // 3. Mask and Merge Segments
    selectSegments(false);

    /*if (printDebug) {
      std::cout << "Masked segmentation data in " << t.elapsed<double>() << " s.\n";
      t.reset();
    }*/
    
    // 4. Run Marching Cubes
    zi::mesh::marching_cubes<T> mc;
    mc.marche(volume_, dim_[2], dim_[1], dim_[0]);

    /*if (printDebug) {
        std::cout << "Marching Cubes completed in " << t.elapsed<double>() << " s.\n";
        t.reset();
    }*/

    // 5. Mesh Cleanup and Simplification
    if (mc.count(1) > 0) {
        std::vector<float> strip;
        zi::mesh::int_mesh im;
        im.add(mc.get_triangles(1));

        zi::mesh::simplifier<double> s;
        im.fill_simplifier<double>(s);

        s.prepare();
        //WriteDegTriStrip(s, "raw.bin");
        strip = CreateDegTriStrip(s);
        meshLength_[0] = strip.size() * sizeof(float);
        meshData_[0] = new char[meshLength_[0]];
        memcpy(meshData_[0], reinterpret_cast<const char*>(&strip[0]), meshLength_[0]);

        /*if (printDebug) {
            std::cout << "Quadrics and Normal calculation done in " << t.elapsed<double>() << " s.\n";
            WriteObj(s, std::to_string(taskID)+"_raw.obj");
            t.reset();
        }*/

        s.optimize(s.face_count() / 10, 1e-12);
        //WriteDegTriStrip(s, "0.bin");
        strip = CreateDegTriStrip(s);
        meshLength_[1] = strip.size() * sizeof(float);
        meshData_[1] = new char[meshLength_[1]];
        memcpy(meshData_[1], reinterpret_cast<const char*>(&strip[0]), meshLength_[1]);
        /*if (printDebug) {
            std::cout << "Simplification 0 completed in " << t.elapsed<double>() << " s.\n";
            WriteObj(s, "test_0.obj");
            t.reset();
        }*/ 

        for (int mip = 1; mip <= 3; ++mip) {
            s.optimize(s.face_count() / 8, 1 << (10*(mip - 1)));
            strip = CreateDegTriStrip(s);
            meshLength_[1 + mip] = strip.size() * sizeof(float);
            meshData_[1 + mip] = new char[meshLength_[1 + mip]];
            memcpy(meshData_[1 + mip], reinterpret_cast<const char*>(&strip[0]), meshLength_[1 + mip]);

            std::ofstream outFile(write_path + std::to_string(mip) + ".dstrip", std::ios::out | std::ofstream::binary);
            outFile.write(meshData_[1 + mip], meshLength_[1 + mip]);
            outFile.close();

            std::cout << "writing to " << write_path + std::to_string(mip) + ".dstrip" << "\n";

            //WriteDegTriStrip(s, std::to_string(mip)+".bin");
            //WriteDegTriStrip(s, "test_" + std::to_string(mip) + ".strip");
            //WriteTriMesh(s, "test_" + std::to_string(mip) + ".mesh");
            /*if (printDebug) {
                std::cout << "Simplification " << std::to_string(mip) << " completed in " << t.elapsed<double>() << " s.\n";
                WriteObj(s, "test_" + std::to_string(mip) + ".obj");
                t.reset();
            }*/
        }
    }

    /*if (printDebug) {
        std::cout << "Press enter to continue ...";
        std::cin.get();
    }*/
}

/*****************************************************************/

template<typename T>
CTaskMesher<T>::~CTaskMesher()
{
  for (int i = 0; i < 5; ++i) {
    delete[] meshData_[i];
    meshData_[i] = NULL;
  }
}

/*****************************************************************/

template<typename T>
inline void CTaskMesher<T>::idxToXYZ(size_t idx, size_t &x, size_t &y, size_t &z) const {
  x = idx % dim_[0];
  y = (idx / dim_[0]) % dim_[1];
  z = idx / (dim_[0] * dim_[1]);
}

/*****************************************************************/

template<typename T>
void CTaskMesher<T>::selectSegmentsFillHoles() {
  const size_t x_off = 1;
  const size_t y_off = dim_[0];
  const size_t z_off = dim_[0] * dim_[1];

  // Visit all voxels that are *not* part of the task segmentation, starting
  // from a corner and set them to 0
  std::vector<bool> queued(dim_[0] * dim_[1] * dim_[2], false);
  std::queue<size_t> outer;
  outer.push(0);

  size_t x_pos, y_pos, z_pos, pos;
  while (!outer.empty()) {
    pos = outer.front();
    outer.pop();

    idxToXYZ(pos, x_pos, y_pos, z_pos);

    if (segments_.find(volume_[pos]) == segments_.end()) {
      volume_[pos] = 0;

      if (x_pos < dim_[0] - 1 && !queued[pos + x_off]) {
        outer.push(pos + x_off);
        queued[pos + x_off] = true;
      }
      if (x_pos > 0 && !queued[pos - x_off]) {
        outer.push(pos - x_off);
        queued[pos - x_off] = true;
      }
      if (y_pos < dim_[1] - 1 && !queued[pos + y_off]) {
        outer.push(pos + y_off);
        queued[pos + y_off] = true;
      }
      if (y_pos > 0 && !queued[pos - y_off]) {
        outer.push(pos - y_off);
        queued[pos - y_off] = true;
      }
      if (z_pos < dim_[2] - 1 && !queued[pos + z_off]) {
        outer.push(pos + z_off);
        queued[pos + z_off] = true;
      }
      if (z_pos > 0 && !queued[pos - z_off]) {
        outer.push(pos - z_off);
        queued[pos - z_off] = true;
      }
    } else {
      volume_[pos] = 1; // That's the outer hull of our segmentation!
    }
  }

  // Everything not queued (visited) is also part of our segmentation and will
  // be set to 1
  for (size_t i = dim_[0] * dim_[1]; i < (dim_[2] - 1) * dim_[0] * dim_[1]; ++i) {
    if (!queued[i])
      volume_[i] = 1;
  }
}

/*****************************************************************/

template<typename T>
void CTaskMesher<T>::selectSegmentsLeaveHoles() {
  for (int pos = 0; pos < dim_[0] * dim_[1] * dim_[2]; ++pos) {
    volume_[pos] = segments_.find(volume_[pos]) != segments_.end();
  }
}

/*****************************************************************/

template<typename T>
void CTaskMesher<T>::selectSegments(bool fillHoles) {
  if (segments_.empty()) {
    memset(volume_, 0, sizeof(T) * dim_[0] * dim_[1] * dim_[2]);
    return;
  }

  // Set all boundary voxel to 0
  memset(volume_, 0, sizeof(T) * dim_[0] * dim_[1]);
  memset(&volume_[(dim_[2] - 1) * dim_[0] * dim_[1]], 0, sizeof(T) * dim_[0] * dim_[1]);
  for (size_t z = 1; z < dim_[2] - 1; ++z) {
    memset(&volume_[z * dim_[0] * dim_[1]], 0, sizeof(T) * dim_[0]);
    memset(&volume_[z * dim_[0] * dim_[1] + (dim_[1] - 1) * dim_[0]], 0, sizeof(T) * dim_[0]);
    for (size_t y = 1; y < dim_[1] - 1; ++y) {
      memset(&volume_[z * dim_[0] * dim_[1] + y * dim_[0] - 1], 0, 2 * sizeof(T));
    }
  }

  if (fillHoles) {
    selectSegmentsFillHoles();
  } else {
    selectSegmentsLeaveHoles();
  }
}

template<typename T>
bool CTaskMesher<T>::GetMesh(uint8_t lod, const char ** data, size_t * length) const
{
  if (lod < 5) {
    if (meshData_[lod]) {
      *length = meshLength_[lod];
      *data   = meshData_[lod];
    } else {
      *length = 0;
      *data = empty_mesh;
    }
    return true;
  }
  return false;
}


/*****************************************************************/

extern "C" TMesher * TaskMesher_Generate_uint8(char * segmentation_path, size_t dim[3], uint8_t segmentCount, uint8_t * segments, char * write_path) {
  std::vector<uint8_t> seg(segments, segments + segmentCount);
  return (TMesher *)(new CTaskMesher<uint8_t>(std::string(segmentation_path), zi::vl::vec<size_t, 3>(dim[0], dim[1], dim[2]), seg, std::string(write_path)));
}

extern "C" TMesher * TaskMesher_Generate_uint16(char * segmentation_path, size_t dim[3], uint16_t segmentCount, uint16_t * segments, char * write_path) {
  std::vector<uint16_t> seg(segments, segments + segmentCount);
  return (TMesher *)(new CTaskMesher<uint16_t>(std::string(segmentation_path), zi::vl::vec<size_t, 3>(dim[0], dim[1], dim[2]), seg, std::string(write_path)));
}

extern "C" TMesher * TaskMesher_Generate_uint32(char * url, size_t dim[3], uint32_t segmentCount, uint32_t * segments, char * write_path) {
  std::vector<uint32_t> seg(segments, segments + segmentCount);
  return (TMesher *)(new CTaskMesher<uint32_t>(std::string(url), zi::vl::vec<size_t, 3>(dim[0], dim[1], dim[2]), seg, std::string(write_path)));
}

extern "C" TMesher * TaskMesher_Generate_uint64(char * url, size_t dim[3], uint64_t segmentCount, uint64_t * segments, char * write_path) {
  std::vector<uint64_t> seg(segments, segments + segmentCount);
  return (TMesher *)(new CTaskMesher<uint64_t>(std::string(url), zi::vl::vec<size_t, 3>(dim[0], dim[1], dim[2]), seg, std::string(write_path)));
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

extern "C" void TaskMesher_Release_uint64(TMesher * taskmesher) {
  delete (CTaskMesher<uint64_t>*)(taskmesher);
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

extern "C" void TaskMesher_GetRawMesh_uint64(TMesher * taskmesher, const char ** data, size_t * length)
{
  ((CTaskMesher<uint64_t>*)(taskmesher))->GetMesh(0, data, length);
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

extern "C" void TaskMesher_GetSimplifiedMesh_uint64(TMesher * taskmesher, uint8_t lod, const char ** data, size_t * length)
{
  ((CTaskMesher<uint64_t>*)(taskmesher))->GetMesh(1 + lod, data, length);
}

/*****************************************************************/