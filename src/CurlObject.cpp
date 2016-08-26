#include "CurlObject.h"

CCurlObject::CCurlObject(const std::string &url) {
  curl_ = curl_easy_init();
  if (!curl_) {
    throw std::string("Error initializing curl");
  }

  curl_easy_setopt(curl_, CURLOPT_WRITEFUNCTION, &CCurlObject::writeData);
  curl_easy_setopt(curl_, CURLOPT_WRITEDATA, &buffer_);
  curl_easy_setopt(curl_, CURLOPT_URL, url.c_str());
  if (curl_easy_perform(curl_) != CURLE_OK) {
    throw std::string("Error performing request to " + url);
  }
}

size_t CCurlObject::writeData(char *data, size_t size, size_t nmemb,
                              std::vector<unsigned char> &buffer) {
  size_t result = 0;
  buffer.insert(buffer.end(), data, data + size * nmemb);
  result = size * nmemb;
  return result;
}

const std::vector<unsigned char> &CCurlObject::getData() const {
  return buffer_;
}
