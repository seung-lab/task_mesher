#include "MeshIO.h"

#include <zi/mesh/marching_cubes.hpp>
#include <zi/mesh/int_mesh.hpp>
#include <zi/mesh/quadratic_simplifier.hpp>
#include <zi/timer.hpp>

#include <fstream>
#include <queue>

/*****************************************************************/
template<typename T>
const char * CTaskMesher<T>::empty_mesh = "";

/*****************************************************************/

template<typename T>
void ScaleVolume(const T * org_buf, size_t from_dim[3], size_t to_dim[3], T * scaled_buf)
{
  std::cout << "Downscaling from [" << from_dim[0] << "," << from_dim[1] << "," << from_dim[2] << "] to [" <<
    to_dim[0] << "," << to_dim[1] << "," << to_dim[2] << "]\n";

  zi::vl::vec<float, 3> scaleFactor(
    (float)from_dim[0] / (float)to_dim[0],
    (float)from_dim[1] / (float)to_dim[1],
    (float)from_dim[2] / (float)to_dim[2]);

  size_t px, py, pz;
  for (size_t z = 0; z < to_dim[2]; ++z) {
    for (size_t y = 0; y < to_dim[1]; ++y) {
      for (size_t x = 0; x < to_dim[0]; ++x) {
         px = floor(x * scaleFactor[0]);
         py = floor(y * scaleFactor[1]);
         pz = floor(z * scaleFactor[2]);
         scaled_buf[x + to_dim[0]*y + to_dim[0]*to_dim[1]*z] = org_buf[px + from_dim[0]*py + from_dim[0]*from_dim[1]*pz];
      }
    }
  }
}

/*****************************************************************/

template<typename T>
void CTaskMesher<T>::ScaleMesh(float scaleFactor[3])
{
  for (int lod = 0; lod < 1 + miplevels_; ++lod) {
    if (meshData_[lod]) {
      float * data = (float*)(meshData_[lod]);
      int length = meshLength_[lod] / sizeof(float);
      
      for (int i = 0; i < length; i += 6) {
        data[i + 0] *= scaleFactor[0];
        data[i + 1] *= scaleFactor[1];
        data[i + 2] *= scaleFactor[2];
        // 3, 4, 5 are the vertex normal
      }
    }
  }
}

/*****************************************************************/

template<typename T>
CTaskMesher<T>::CTaskMesher(std::vector<T> segmentation, const zi::vl::vec<size_t, 3> & dim, const std::vector<T> & segments, uint8_t miplevels) :
volume_(std::move(segmentation)), meshed_(false), dim_(dim), segments_(segments.begin(), segments.end()), miplevels_(miplevels)
{
    for (int i = 0; i < 1 + miplevels_; ++i) {
      meshData_[i] = NULL;
    }

    if (segments_.empty()) { // Shortcut for empty tasks
        meshed_ = true;
        return;
    }

    zi::wall_timer t;
    t.reset();

    // 3. Mask and Merge Segments
    selectSegments(false);

    std::cout << "Masking segmentation data: " << t.elapsed<double>() << " s\n";
    t.reset();
    
    // 4. Run Marching Cubes
    zi::mesh::marching_cubes<T> mc;
    mc.marche(&volume_[0], dim_[2], dim_[1], dim_[0]);

    std::cout << "Marching Cubes: " << t.elapsed<double>() << " s\n";
    t.reset();

    // 5. Mesh Cleanup and Simplification
    if (mc.count(1) > 0) {
        std::vector<float> strip;
        zi::mesh::int_mesh im;
        im.add(mc.get_triangles(1));

        zi::mesh::simplifier<double> s;
        im.fill_simplifier<double>(s);
        s.prepare();

        std::cout << "Quadrics and Normal calculation." << t.elapsed<double>() << " s\n";
        t.reset();

        strip = CreateDegTriStrip(s);
        meshLength_[0] = strip.size() * sizeof(float);
        meshData_[0] = new char[meshLength_[0]];
        memcpy(meshData_[0], reinterpret_cast<const char*>(&strip[0]), meshLength_[0]);

        std::cout << "Original MC mesh, no simplification: " << t.elapsed<double>() << " s\n";
        t.reset();

        if (miplevels_ == 0) {
          return;
        }

        s.optimize(s.face_count() / 10, 1e-12);
        strip = CreateDegTriStrip(s);
        meshLength_[1] = strip.size() * sizeof(float);
        meshData_[1] = new char[meshLength_[1]];
        memcpy(meshData_[1], reinterpret_cast<const char*>(&strip[0]), meshLength_[1]);

        std::cout << "Initial (lossless) simplification: " << t.elapsed<double>() << " s\n";
        t.reset();

        for (int mip = 1; mip <= 3; ++mip) {
          if (miplevels_ == mip) {
            break;
          }

          s.optimize(s.face_count() / 8, 1 << (10*(mip - 1)));
          strip = CreateDegTriStrip(s);
          meshLength_[1 + mip] = strip.size() * sizeof(float);
          meshData_[1 + mip] = new char[meshLength_[1 + mip]];
          memcpy(meshData_[1 + mip], reinterpret_cast<const char*>(&strip[0]), meshLength_[1 + mip]);

          std::cout << "Simplification " << std::to_string(mip) << ": " << t.elapsed<double>() << " s\n";
          t.reset();
        }
    }
}

/*****************************************************************/

template<typename T>
CTaskMesher<T>::~CTaskMesher()
{
  for (int i = 0; i < 1 + miplevels_; ++i) {
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
    memset(&volume_[0], 0, sizeof(T) * dim_[0] * dim_[1] * dim_[2]);
    return;
  }

  // Set all boundary voxel to 0
  memset(&volume_[0], 0, sizeof(T) * dim_[0] * dim_[1]);
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

/*****************************************************************/

template<typename T>
bool CTaskMesher<T>::GetMesh(uint8_t lod, const char ** data, size_t * length) const
{
  if (lod < 1 + miplevels_) {
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