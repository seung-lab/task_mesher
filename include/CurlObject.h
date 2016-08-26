#pragma once

#ifndef CURL_OBJECT_H
#define CURL_OBJECT_H

#include <vector>
#include <string>

#include <curl/curl.h>
#ifndef CURLPIPE_MULTIPLEX
/* This little trick will just make sure that we don't enable pipelining for
libcurls old enough to not have this symbol. It is _not_ defined to zero in
a recent libcurl header. */
#define CURLPIPE_MULTIPLEX 0
#endif

class CCurlObject {
private:
  CURL                       * curl_;
  std::vector<unsigned char>   buffer_;

public:
  CCurlObject(const std::string &url);

  static size_t writeData(char * data, size_t size, size_t nmemb, std::vector<unsigned char> &buffer);
  const std::vector<unsigned char> & getData() const;
};

#endif
