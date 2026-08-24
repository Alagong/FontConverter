
// TTF2WOFF2.h : main header file for the PROJECT_NAME application
//

#pragma once

#ifndef __AFXWIN_H__
	#error "include 'pch.h' before including this file for PCH"
#endif

#include "resource.h"		// main symbols


// CTTF2WOFF2App:
// See TTF2WOFF2.cpp for the implementation of this class
//

class CTTF2WOFF2App : public CWinApp
{
public:
	CTTF2WOFF2App();

// Overrides
public:
	virtual BOOL InitInstance();

// Implementation

	DECLARE_MESSAGE_MAP()
};

extern CTTF2WOFF2App theApp;
