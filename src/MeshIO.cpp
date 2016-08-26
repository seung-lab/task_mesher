#include "MeshIO.h"

#include <fstream>

bool WriteDegTriStrip(zi::mesh::simplifier<double> &s, const std::string &filename) {
  std::vector<zi::vl::vec3d> points;
  std::vector<zi::vl::vec3d> normals;
  std::vector<uint32_t> indices;
  std::vector<uint32_t> strip_begins;
  std::vector<uint32_t> strip_lengths;

  s.stripify(points, normals, indices, strip_begins, strip_lengths);

  std::vector<float> degen;

  tri_strip_to_degenerate(degen, points, normals, indices, strip_begins,
                          strip_lengths);

  std::ofstream out(filename,
                    std::ios::out | std::ios::binary | std::ios::trunc);

  if (out) {
    float *buff = new float[degen.size()];

    std::copy(degen.begin(), degen.end(), buff);

    out.write(reinterpret_cast<char *>(buff),
              static_cast<std::streamsize>(degen.size() * sizeof(float)));

    delete[] buff;

    return true;
  }
  return false;
}

std::vector<float> CreateDegTriStrip(zi::mesh::simplifier<double> &s) {
  std::vector<zi::vl::vec3d> points;
  std::vector<zi::vl::vec3d> normals;
  std::vector<uint32_t> indices;
  std::vector<uint32_t> strip_begins;
  std::vector<uint32_t> strip_lengths;

  s.stripify(points, normals, indices, strip_begins, strip_lengths);

  std::vector<float> degen;

  tri_strip_to_degenerate(degen, points, normals, indices, strip_begins, strip_lengths);

  return degen;
}

bool WriteTriMesh(zi::mesh::simplifier<double> & s, const std::string & filename) {
  std::vector<zi::vl::vec3d> points;
  std::vector<zi::vl::vec3d> normals;
  std::vector<vec3u> faces;
  std::size_t sizes[2];

  std::ofstream out(filename, std::ios::out | std::ios::binary | std::ios::trunc);

  if (out) {
    s.get_faces(points, normals, faces);
    sizes[0] = points.size();
    sizes[1] = faces.size();

    float          * pbuff = new float[3 * sizes[0]];
    float          * nbuff = new float[3 * sizes[0]];
    unsigned short * fbuff = new unsigned short[3 * sizes[1]];

    size_t i = 0;
    for (auto v = points.begin(); v != points.end(); ++v) {
      pbuff[i++] = (*v)[2];
      pbuff[i++] = (*v)[1];
      pbuff[i++] = (*v)[0];
    }

    i = 0; 
    for (auto vn = normals.begin(); vn != normals.end(); ++vn) {
      nbuff[i++] = (*vn)[2];
      nbuff[i++] = (*vn)[1];
      nbuff[i++] = (*vn)[0];
    }

    i = 0;
    for (auto f = faces.begin(); f != faces.end(); ++f) {
      fbuff[i++] = (*f)[0];
      fbuff[i++] = (*f)[2];
      fbuff[i++] = (*f)[1];
    }

    out.write(reinterpret_cast<char*>(sizes), static_cast<std::streamsize>(2 * sizeof(std::size_t)));
    out.write(reinterpret_cast<char*>(pbuff), static_cast<std::streamsize>(sizes[0] * sizeof(float)));
    out.write(reinterpret_cast<char*>(nbuff), static_cast<std::streamsize>(sizes[0] * sizeof(float)));
    out.write(reinterpret_cast<char*>(fbuff), static_cast<std::streamsize>(sizes[1] * sizeof(unsigned short)));

    delete[] pbuff;
    delete[] nbuff;
    delete[] fbuff;

    return true;
  }
  return false;
}

bool WriteObj(zi::mesh::simplifier<double> & s, const std::string & filename) {
  std::vector<zi::vl::vec3d> points;
  std::vector<zi::vl::vec3d> normals;
  std::vector<vec3u> faces;

  s.get_faces(points, normals, faces);

  std::ofstream out(filename, std::ios::out);
  if (out) {
    for (auto v = points.begin(); v < points.end(); ++v) {
      out << "v " << (*v)[2] << " " << (*v)[1] << " " << (*v)[0] << "\n";
    }

    for (auto vn = normals.begin(); vn < normals.end(); ++vn) {
      out << "vn " << (*vn)[2] << " " << (*vn)[1] << " " << (*vn)[0] << "\n";
    }

    for (auto f = faces.begin(); f < faces.end(); ++f) {
      out << "f " << (*f)[0] + 1 << "//" << (*f)[0] + 1 << " " << (*f)[2] + 1
            << "//" << (*f)[2] + 1 << " " << (*f)[1] + 1 << "//" << (*f)[1] + 1
            << "\n";
    }
    return true;
  }
  return false;
}

void tri_strip_to_degenerate(std::vector<float> &newpoints,
                             const std::vector<zi::vl::vec3d> &points,
                             const std::vector<zi::vl::vec3d> &normals,
                             const std::vector<uint32_t> &indices,
                             const std::vector<uint32_t> &starts,
                             const std::vector<uint32_t> &lengths) {

  newpoints.clear();

  for (std::size_t i = 0; i < starts.size(); ++i) {
    if (i > 0) {
      // add the last point
      {
        std::size_t idx = indices[starts[i - 1] + lengths[i - 1] - 1];
        newpoints.push_back(static_cast<float>(points[idx].at(2)));
        newpoints.push_back(static_cast<float>(points[idx].at(1)));
        newpoints.push_back(static_cast<float>(points[idx].at(0)));
        newpoints.push_back(static_cast<float>(normals[idx].at(2)));
        newpoints.push_back(static_cast<float>(normals[idx].at(1)));
        newpoints.push_back(static_cast<float>(normals[idx].at(0)));
      }

      if ((newpoints.size() / 6) % 2 == 0) {
        std::size_t idx = indices[starts[i]];
        newpoints.push_back(static_cast<float>(points[idx].at(2)));
        newpoints.push_back(static_cast<float>(points[idx].at(1)));
        newpoints.push_back(static_cast<float>(points[idx].at(0)));
        newpoints.push_back(static_cast<float>(normals[idx].at(2)));
        newpoints.push_back(static_cast<float>(normals[idx].at(1)));
        newpoints.push_back(static_cast<float>(normals[idx].at(0)));
      }

      {
        std::size_t idx = indices[starts[i]];
        newpoints.push_back(static_cast<float>(points[idx].at(2)));
        newpoints.push_back(static_cast<float>(points[idx].at(1)));
        newpoints.push_back(static_cast<float>(points[idx].at(0)));
        newpoints.push_back(static_cast<float>(normals[idx].at(2)));
        newpoints.push_back(static_cast<float>(normals[idx].at(1)));
        newpoints.push_back(static_cast<float>(normals[idx].at(0)));
      }
    }

    for (uint32_t j = starts[i]; j < starts[i] + lengths[i]; ++j) {
      std::size_t idx = indices[j];
      newpoints.push_back(static_cast<float>(points[idx].at(2)));
      newpoints.push_back(static_cast<float>(points[idx].at(1)));
      newpoints.push_back(static_cast<float>(points[idx].at(0)));
      newpoints.push_back(static_cast<float>(normals[idx].at(2)));
      newpoints.push_back(static_cast<float>(normals[idx].at(1)));
      newpoints.push_back(static_cast<float>(normals[idx].at(0)));
    }
  }
}
