#include "CurlObject.h"
#include "MeshIO.h"

#include <vector>
#include <string>
#include <iostream>
#include <queue>
#include <fstream>
#include <sstream>
#include <limits>

#include <zi/mesh/marching_cubes.hpp>
#include <zi/mesh/int_mesh.hpp>
#include <zi/mesh/quadratic_simplifier.hpp>
#include <set>
#include <zi/time.hpp>
#include <zi/vl/vec.hpp>





#define TASK_MESHER_VERSION "0.1"

// DEBUG VALUES
#define SEGMENTATION_URL                                                       \
  "https://storage.googleapis.com/zebrafish_web_4x4x4/"                        \
  "153742.segmentation.lzma"

#define TASK_SIZE_X 1024
#define TASK_SIZE_Y 1024
#define TASK_SIZE_Z 128
#define TASK_DATATYPE int16_t

#define DECOMPRESSED_SIZE                                                      \
  (TASK_SIZE_X * TASK_SIZE_Y * TASK_SIZE_Z * sizeof(TASK_DATATYPE))

const TASK_DATATYPE SEGMENTS_SMALL[] = {7303, 7440, 7447, 7495,
                                        7496, 7542, 7607, 7608};
const TASK_DATATYPE SEGMENTS_BIG[]   = {5547, 6700, 7105, 7046, 7369, 7300, 7375, 7305, 7606, 7297, 7295, 7230, 7307, 7039, 7107, 7102,
                                        7021, 6766, 6895, 6907, 7043, 7120, 7177, 7050, 6980, 6785, 6380, 7411, 7474, 7573, 7711, 7813,
                                        7060, 7134, 6659, 7131, 4012, 3957, 7619, 6527};






int main2(int argc, char *argv[]) {
  bool removeInclusions = false;
  bool printDebug = false;
  size_t taskID = 0;
  std::string segmentationURL = "";
  std::vector<TASK_DATATYPE> segmentVec;

  if (argc > 1) {
    for (argc--, argv++; *argv; argc--, argv++) {
      if (strncmp(*argv, "-H", 2) == 0) {
        std::cerr << "Usage: " << argv[0] << " -TID=123456 -URL=https://link/to/segmentation.lzma -SEG=12,34,56,789 [-I] [-D]\n" <<
        "-I: Remove inclusions, slower, potentially smaller filesize, i.a. necessary for 3D printing\n" <<
        "-D: Show debug messages and write debug output (TID.obj)\n";
        exit(EXIT_FAILURE);
      }
      else if (strncmp(*argv, "-V", 2) == 0) {
        std::cerr << argv[0] << " " << TASK_MESHER_VERSION << "\n";
        exit(EXIT_FAILURE);
      }
      else if (strncmp(*argv, "-I", 2) == 0) {
        removeInclusions = true;
      }
      else if (strncmp(*argv, "-D", 2) == 0) {
        printDebug = true;
      }
      else if (strncmp(*argv, "-TID=", 5) == 0) {
        try {
          std::stoi(std::string((*argv)+5), &taskID, 10);
        }
        catch (const std::invalid_argument & e) {
          std::cerr << "ERROR: " << e.what() << "\n";
          exit(EXIT_FAILURE);
        }
        catch (const std::out_of_range & e) {
          std::cerr << "ERROR: " << e.what() << "\n";
          exit(EXIT_FAILURE);
        }
        catch (...) {
          std::cerr << "ERROR: Unknown error while reading task ID.\n";
          exit(EXIT_FAILURE);
        }
      }
      else if (strncmp(*argv, "-URL=", 5) == 0) {
        segmentationURL = std::string((*argv)+5);
        // TODO: Some error checks
      }
      else if (strncmp(*argv, "-SEG=", 5) == 0) {
        std::string segmentStr((*argv)+5);
        std::replace(segmentStr.begin(), segmentStr.end(), ',', ' ');

        std::stringstream iss(segmentStr);
        long long segment;
        while (iss >> segment) {
          if (segment != 0 && segment >= std::numeric_limits<TASK_DATATYPE>::min() && segment <= std::numeric_limits<TASK_DATATYPE>::max())
            segmentVec.push_back(segment);
          else {
            std::cerr << "ERROR: Segment ID " << segment << " is out of bounds.\n";
            exit(EXIT_FAILURE);
          }
        }
      }
      else {
        std::cerr << "ERROR: invalid or unknown option " << argv << "\n";
        exit(EXIT_FAILURE);
      }
    }
  } else {
    std::cerr << "Usage: " << argv[0] << " -TID=123456 -URL=https://link/to/segmentation.lzma [-I] [-T]\n" <<
    "-I: Remove inclusions, slower, potentially smaller filesize, i.a. necessary for 3D printing\n" <<
    "-T: Show time spent for each step\n";
    exit(EXIT_FAILURE);
  }

  zi::wall_timer t;
  t.restart();

  // 0. Check if there are segments selected, otherwise, erase mesh for task
  if (segmentVec.empty()) {
    // TODO: Erase task mesh

    return 0;
  }

  // 1. Download Segmentations
  std::vector<unsigned char> compressedBuf;
  try {
    CCurlObject request(segmentationURL);
    compressedBuf = request.getData();
  }
  catch (const std::string & e) {
    std::cerr << e;
    exit(EXIT_FAILURE);
  }

  if (printDebug) {
    std::cout << "Downloaded segmentation data in: " << t.elapsed<double>() << " s.\n";
    t.reset();
  }

  // 2. Decompress LZMA stream
  std::vector<unsigned char> decompressedBuf;
  decompress(compressedBuf, decompressedBuf);

  if (printDebug) {
    std::cout << "Decompressed segmentation data in: " << t.elapsed<double>() << " s.\n";
    t.reset();
  }

  // 3. Mask task segments only:
  std::set<TASK_DATATYPE> segments(std::begin(segmentVec),std::end(segmentVec));
  
  selectSegments(reinterpret_cast<TASK_DATATYPE *>(&decompressedBuf[0]),
                 segments, TASK_SIZE_X, TASK_SIZE_Y, TASK_SIZE_Z, removeInclusions);

  if (printDebug) {
    std::cout << "Masked segmentation data in " << t.elapsed<double>() << " s.\n";
    t.reset();
  }
  
  // 3. Run Marching Cubes
  zi::mesh::marching_cubes<TASK_DATATYPE> mc;
  mc.marche(reinterpret_cast<TASK_DATATYPE *>(&decompressedBuf[0]), TASK_SIZE_Z,
            TASK_SIZE_Y, TASK_SIZE_X);

  if (printDebug) {
    std::cout << "Marching Cubes completed in " << t.elapsed<double>() << " s.\n";
    t.reset();
  }

  // 4. Mesh Cleanup and Simplification
  if (mc.count(1) > 0) {
    zi::mesh::int_mesh im;
    im.add(mc.get_triangles(1));

    zi::mesh::simplifier<double> s;
    im.fill_simplifier<double>(s);

    s.prepare();
    if (printDebug) {
      std::cout << "Quadrics and Normal calculation done in " << t.elapsed<double>() << " s.\n";
      WriteObj(s, std::to_string(taskID)+"_raw.obj");
      t.reset();
    }  

    s.optimize(s.face_count() / 10, 1e-12);
    if (printDebug) {
      std::cout << "Simplification 0 completed in " << t.elapsed<double>() << " s.\n";
      WriteObj(s, "test_0.obj");
      t.reset();
    }  

    for (int mip = 1; mip <= 3; ++mip) {
      s.optimize(s.face_count() / 8, 1 << (10*(mip - 1)));
      WriteDegTriStrip(s, "test_" + std::to_string(mip) + ".strip");
      WriteTriMesh(s, "test_" + std::to_string(mip) + ".mesh");
      if (printDebug) {
        std::cout << "Simplification " << std::to_string(mip) << " completed in " << t.elapsed<double>() << " s.\n";
        WriteObj(s, "test_" + std::to_string(mip) + ".obj");
        t.reset();
      }
    }
  }

  if (printDebug) {
    std::cout << "Press enter to continue ...";
    std::cin.get();
  }
}