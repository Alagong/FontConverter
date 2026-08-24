
// TTF2WOFF2Dlg.h : header file
//

#pragma once

#include <vector>

#define NUM_THREAD  8

typedef struct FileNameRec
{
    CString  filePath;
    CString  fileName;
}FileName;


// CTTF2WOFF2Dlg dialog
class CTTF2WOFF2Dlg : public CDialogEx
{
// Construction
public:
	CTTF2WOFF2Dlg(CWnd* pParent = nullptr);	// standard constructor
    ~CTTF2WOFF2Dlg();

// Dialog Data
#ifdef AFX_DESIGN_TIME
	enum { IDD = IDD_TTF2WOFF2_DIALOG };
#endif

	protected:
	virtual void DoDataExchange(CDataExchange* pDX);	// DDX/DDV support


    void   thread_finish( UINT32 tag );
    static UINT ThreadFun(LPVOID);

    UINT32  thread_status[NUM_THREAD];
    CRITICAL_SECTION cs;

    bool     ConvertFont( CString& src, CString& dst );
    CString  GetFileName(CString& path, CString& ExtendName);
    void     ScanFiles(CString& folder, std::vector< FileName >& container);
    void     CopyDirecotyTree( CString& srcFolder, CString& dstFolder );

    BOOL        m_isSingle;
    CString     m_filePath;
    CString     m_srcFolder;
    CString     m_dstFolder;



// Implementation
protected:
	HICON m_hIcon;

	// Generated message map functions
	virtual BOOL OnInitDialog();
	afx_msg void OnSysCommand(UINT nID, LPARAM lParam);
	afx_msg void OnPaint();
	afx_msg HCURSOR OnQueryDragIcon();
	DECLARE_MESSAGE_MAP()
public:
    afx_msg void OnBnClickedButton1();
    afx_msg void OnBnClickedButton2();
    
    afx_msg void OnBnClickedOk();
};
