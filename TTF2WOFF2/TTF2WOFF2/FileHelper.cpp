// FileHelper.cpp : implementation file
//

#include "pch.h"
#include <stdio.h>
#include "FileHelper.h"


// FileHelper

FileHelper::FileHelper()
{
}

FileHelper::~FileHelper()
{
}


// FileHelper member functions
bool FileHelper::ReadFile( CString& path, unsigned char** r_buffer, size_t* r_len )
{
    FILE*          f = NULL;
    size_t       len = 0;
    size_t  haveRead = 0;
    unsigned char* buffer = NULL;

    if( !path )
        return  NULL;

    f = fopen( path, "rb" );
    if( !f )
        goto Fail;

    fseek( f, 0, SEEK_END );
    len = ftell( f );
    fseek( f, 0, SEEK_SET );

    buffer = (unsigned char*) calloc ( 1, len );
    if( !buffer )
        goto Fail;

    while( haveRead < len )
    {
        int unit = 2048;
        if( haveRead + unit > len )
            unit = len - haveRead;

        haveRead += fread( buffer + haveRead, 1, unit, f );
    }

    fclose( f );

    if( r_len )     *r_len    = len;
    if( r_buffer )  *r_buffer = buffer;

    return true;

Fail:
    if( buffer )    free( buffer );
    if( f )         fclose( f );
    return false;
}


void FileHelper::WriteFile( CString& path, unsigned char* buffer, long len )
{
    FILE* f = fopen( path.GetBuffer(), "wb" );
    if( !f )
        return;

    if( buffer )
        fwrite( buffer, 1, len, f );

    fclose( f );
}