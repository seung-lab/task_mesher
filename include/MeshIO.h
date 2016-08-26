#pragma once

#ifndef MESH_IO_H
#define MESH_IO_H

#include <zi/mesh/quadratic_simplifier.hpp>
#include <string>
#include <vector>
#include <zi/vl/vec.hpp>

typedef zi::vl::vec<uint32_t, 3> vec3u;
typedef zi::vl::vec<uint32_t, 4> vec4u;
typedef zi::vl::vec<uint32_t, 5> vec5u;

std::vector<float> CreateDegTriStrip(zi::mesh::simplifier<double> &s);
bool WriteDegTriStrip(zi::mesh::simplifier<double> & s, const std::string & filename);
bool WriteTriMesh(zi::mesh::simplifier<double> & s, const std::string & filename);
bool WriteObj(zi::mesh::simplifier<double> & s, const std::string & filename);

void tri_strip_to_degenerate(std::vector<float> & newpoints,
                             const std::vector<zi::vl::vec3d> & points,
                             const std::vector<zi::vl::vec3d> & normals,
                             const std::vector<uint32_t> & indices,
                             const std::vector<uint32_t> & starts,
                             const std::vector<uint32_t> & lengths);


#endif
