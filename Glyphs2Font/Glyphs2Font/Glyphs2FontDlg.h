
// Glyphs2FontDlg.h : header file
//

#pragma once


// CGlyphs2FontDlg dialog
class CGlyphs2FontDlg : public CDialogEx
{
// Construction
public:
	CGlyphs2FontDlg(CWnd* pParent = nullptr);	// standard constructor

// Dialog Data
#ifdef AFX_DESIGN_TIME
	enum { IDD = IDD_GLYPHS2FONT_DIALOG };
#endif

	protected:
	virtual void DoDataExchange(CDataExchange* pDX);	// DDX/DDV support


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
    CString m_source;
    CString m_DestFolder;
    INT m_export;
    afx_msg void OnBnClickedButton2();
    afx_msg void OnBnClickedOk();
    void makeFont( );
    CString m_familyName;
    INT m_sourceType;
};
