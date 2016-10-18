#!/bin/bash
ZILIBDIR="./third_party/zi_lib"

CXXINCLUDES="-I/usr/include -I./include -I$ZILIBDIR"
CXXLIBS="-L./lib -L/usr/lib/x86_64-linux-gnu"
COMMON_FLAGS="-fPIC -g -std=c++11"
OPTIMIZATION_FLAGS="-DNDEBUG -O3"

echo "Compiling RTM"
g++ -c $CXXINCLUDES $CXXLIBS $COMMON_FLAGS $OPTIMIZATION_FLAGS src/MeshIO.cpp -o build/MeshIO.o
g++ -c $CXXINCLUDES $CXXLIBS $COMMON_FLAGS $OPTIMIZATION_FLAGS src/TaskMesher.cpp -o build/TaskMesher.o

echo "Creating librtm.so"
g++ $CXXLIBS -shared -fPIC -o lib/librtm.so build/MeshIO.o build/TaskMesher.o
