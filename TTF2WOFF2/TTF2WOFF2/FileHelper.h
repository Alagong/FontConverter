#pragma once

// FileHelper command target

class FileHelper : public CObject
{
public:
	FileHelper();
	virtual ~FileHelper();

    static bool ReadFile( CString& path,  unsigned char** r_buffer, size_t* r_len );
    static void WriteFile( CString& path, unsigned char* buffer, long len );
};


