#!/bin/bash
LZMADIR="./third_party/lzma"
ZILIBDIR="./third_party/zi_lib"

CXXINCLUDES="-I/usr/include -I./include -I$LZMADIR -I$ZILIBDIR"
CXXLIBS="-L./lib -L/usr/lib/x86_64-linux-gnu"
COMMON_FLAGS="-fPIC -g -std=c++11"
OPTIMIZATION_FLAGS="-DNDEBUG -O3"

echo "Compiling LZMA decoding"
g++ -c $COMMON_FLAGS $OPTIMIZATION_FLAGS $LZMADIR/LzmaLib.c -o build/LzmaLib.o
g++ -c $COMMON_FLAGS $OPTIMIZATION_FLAGS $LZMADIR/LzmaDec.c -o build/LzmaDec.o
g++ -c $COMMON_FLAGS $OPTIMIZATION_FLAGS $LZMADIR/Alloc.c -o build/Alloc.o

echo "Creating liblzma_dec.a"
ar rcs lib/liblzma_dec.a build/LzmaLib.o build/LzmaDec.o build/Alloc.o

echo "Compiling RTM"
g++ -c $CXXINCLUDES $CXXLIBS $COMMON_FLAGS $OPTIMIZATION_FLAGS src/MeshIO.cpp -o build/MeshIO.o
g++ -c $CXXINCLUDES $CXXLIBS $COMMON_FLAGS $OPTIMIZATION_FLAGS src/LZMADec.cpp -Wl,-Bstatic -llzma_dec -o build/LZMADec.o
# g++ -c $CXXINCLUDES $CXXLIBS $COMMON_FLAGS $OPTIMIZATION_FLAGS src/CurlObject.cpp -Wl,-Bdynamic -lcurl -o build/CurlObject.o
g++ -c $CXXINCLUDES $CXXLIBS $COMMON_FLAGS $OPTIMIZATION_FLAGS src/TaskMesher.cpp -o build/TaskMesher.o

echo "Creating librtm.so"
g++ $CXXLIBS -shared -fPIC -o lib/librtm.so build/MeshIO.o build/LZMADec.o build/TaskMesher.o  -Wl,-Bstatic -llzma_dec -Wl,-Bdynamic
