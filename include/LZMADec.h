#pragma once

#ifndef LZMA_DEC_H
#define LZMA_DEC_H

#include <vector>
#include <cstdio>
#include <cstdint>


class LZMADec {
private:
  bool                       ok_;
  std::vector<unsigned char> decompressed_;
  

public:
  static const uint32_t      kHeaderLength;

  LZMADec(const std::vector<unsigned char> & input, size_t outputLength);
  ~LZMADec();

  const std::vector<unsigned char> & getUncompressed() const;

};



#endif
