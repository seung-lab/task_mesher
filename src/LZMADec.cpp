#include "LZMADec.h"

#include <LzmaLib.h>

const uint32_t LZMADec::kHeaderLength = 13;

LZMADec::LZMADec(const std::vector<unsigned char> &input, size_t outputLength)
: ok_(false)
{
  if (input.size() <= kHeaderLength)
    return;

  decompressed_.resize(outputLength);

  size_t dstLen = decompressed_.size();
  size_t srcLen = input.size() - kHeaderLength;

  SRes result = LzmaUncompress(&decompressed_[0], &dstLen, &input[kHeaderLength], &srcLen, &input[0], LZMA_PROPS_SIZE);

  if (result != SZ_OK || dstLen != outputLength) {
    decompressed_.clear();
    return;
  }

  ok_ = true;
  return;
}

LZMADec::~LZMADec()
{
}

const std::vector<unsigned char> &LZMADec::getUncompressed() const
{
    return decompressed_;
}