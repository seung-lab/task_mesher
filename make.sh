#!/bin/bash
GCC="g++-5"
ZILIBDIR="./third_party/zi_lib"

CXXINCLUDES="-I/usr/include -I./include -I$ZILIBDIR"
CXXLIBS="-L./lib -L/usr/lib/x86_64-linux-gnu"
COMMON_FLAGS="-fPIC -g -std=c++11"
OPTIMIZATION_FLAGS="-DNDEBUG -O3"

mkdir -p build
mkdir -p lib

echo "Compiling RTM"
$GCC -c $CXXINCLUDES $CXXLIBS $COMMON_FLAGS $OPTIMIZATION_FLAGS src/MeshIO.cpp -o build/MeshIO.o
$GCC -c $CXXINCLUDES $CXXLIBS $COMMON_FLAGS $OPTIMIZATION_FLAGS src/TaskMesher.cpp -o build/TaskMesher.o

echo "Creating librtm.so"
$GCC $CXXLIBS -shared -fPIC -o lib/librtm.so build/MeshIO.o build/TaskMesher.o
