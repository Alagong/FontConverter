
// Glyphs2FontDlg.cpp : implementation file
//

#include "pch.h"
#include "framework.h"
#include "Glyphs2Font.h"
#include "Glyphs2FontDlg.h"
#include "afxdialogex.h"

#ifdef _DEBUG
#define new DEBUG_NEW
#endif


// CAboutDlg dialog used for App About

class CAboutDlg : public CDialogEx
{
public:
	CAboutDlg();

// Dialog Data
#ifdef AFX_DESIGN_TIME
	enum { IDD = IDD_ABOUTBOX };
#endif

	protected:
	virtual void DoDataExchange(CDataExchange* pDX);    // DDX/DDV support

// Implementation
protected:
	DECLARE_MESSAGE_MAP()
};

CAboutDlg::CAboutDlg() : CDialogEx(IDD_ABOUTBOX)
{
}

void CAboutDlg::DoDataExchange(CDataExchange* pDX)
{
	CDialogEx::DoDataExchange(pDX);
}

BEGIN_MESSAGE_MAP(CAboutDlg, CDialogEx)
END_MESSAGE_MAP()


// CGlyphs2FontDlg dialog



CGlyphs2FontDlg::CGlyphs2FontDlg(CWnd* pParent /*=nullptr*/)
	: CDialogEx(IDD_GLYPHS2FONT_DIALOG, pParent)
    , m_source(_T(""))
    , m_DestFolder(_T(""))
    , m_export(0)
    , m_familyName(_T(""))
    , m_sourceType(0)
{
	m_hIcon = AfxGetApp()->LoadIcon(IDR_MAINFRAME);
}

void CGlyphs2FontDlg::DoDataExchange(CDataExchange* pDX)
{
    CDialogEx::DoDataExchange(pDX);
    DDX_Text(pDX, IDC_EDIT1, m_source);
    DDX_Text(pDX, IDC_EDIT2, m_DestFolder);
    DDX_Radio(pDX, IDC_RADIO1, m_export);
    DDX_Text(pDX, IDC_EDIT3, m_familyName);
    DDX_Radio(pDX, IDC_RADIO5, m_sourceType);
}

BEGIN_MESSAGE_MAP(CGlyphs2FontDlg, CDialogEx)
	ON_WM_SYSCOMMAND()
	ON_WM_PAINT()
	ON_WM_QUERYDRAGICON()
    ON_BN_CLICKED(IDC_BUTTON1, &CGlyphs2FontDlg::OnBnClickedButton1)
    ON_BN_CLICKED(IDC_BUTTON2, &CGlyphs2FontDlg::OnBnClickedButton2)
    ON_BN_CLICKED(IDOK, &CGlyphs2FontDlg::OnBnClickedOk)
END_MESSAGE_MAP()


// CGlyphs2FontDlg message handlers

BOOL CGlyphs2FontDlg::OnInitDialog()
{
	CDialogEx::OnInitDialog();

	// Add "About..." menu item to system menu.

	// IDM_ABOUTBOX must be in the system command range.
	ASSERT((IDM_ABOUTBOX & 0xFFF0) == IDM_ABOUTBOX);
	ASSERT(IDM_ABOUTBOX < 0xF000);

	CMenu* pSysMenu = GetSystemMenu(FALSE);
	if (pSysMenu != nullptr)
	{
		BOOL bNameValid;
		CString strAboutMenu;
		bNameValid = strAboutMenu.LoadString(IDS_ABOUTBOX);
		ASSERT(bNameValid);
		if (!strAboutMenu.IsEmpty())
		{
			pSysMenu->AppendMenu(MF_SEPARATOR);
			pSysMenu->AppendMenu(MF_STRING, IDM_ABOUTBOX, strAboutMenu);
		}
	}

	// Set the icon for this dialog.  The framework does this automatically
	//  when the application's main window is not a dialog
	SetIcon(m_hIcon, TRUE);			// Set big icon
	SetIcon(m_hIcon, FALSE);		// Set small icon

	// TODO: Add extra initialization here

	return TRUE;  // return TRUE  unless you set the focus to a control
}

void CGlyphs2FontDlg::OnSysCommand(UINT nID, LPARAM lParam)
{
	if ((nID & 0xFFF0) == IDM_ABOUTBOX)
	{
		CAboutDlg dlgAbout;
		dlgAbout.DoModal();
	}
	else
	{
		CDialogEx::OnSysCommand(nID, lParam);
	}
}

// If you add a minimize button to your dialog, you will need the code below
//  to draw the icon.  For MFC applications using the document/view model,
//  this is automatically done for you by the framework.

void CGlyphs2FontDlg::OnPaint()
{
	if (IsIconic())
	{
		CPaintDC dc(this); // device context for painting

		SendMessage(WM_ICONERASEBKGND, reinterpret_cast<WPARAM>(dc.GetSafeHdc()), 0);

		// Center icon in client rectangle
		int cxIcon = GetSystemMetrics(SM_CXICON);
		int cyIcon = GetSystemMetrics(SM_CYICON);
		CRect rect;
		GetClientRect(&rect);
		int x = (rect.Width() - cxIcon + 1) / 2;
		int y = (rect.Height() - cyIcon + 1) / 2;

		// Draw the icon
		dc.DrawIcon(x, y, m_hIcon);
	}
	else
	{
		CDialogEx::OnPaint();
	}
}

// The system calls this function to obtain the cursor to display while the user drags
//  the minimized window.
HCURSOR CGlyphs2FontDlg::OnQueryDragIcon()
{
	return static_cast<HCURSOR>(m_hIcon);
}



void CGlyphs2FontDlg::OnBnClickedButton1()
{
    // TODO: Add your control notification handler code here
    UpdateData(TRUE);

    if( m_sourceType == 0 || m_sourceType == 2 )
    {
        CFileDialog  dlgFile(TRUE, NULL, NULL, OFN_HIDEREADONLY, _T("Glyphs Files (*.glyphs;*.glyphspackage)|*.glyphs;*.glyphsPackage|All Files (*.*)|*.*||"), NULL);        if( dlgFile.DoModal() == IDOK )
            m_source = dlgFile.GetPathName();
        else
            m_source = _T("");
    }
    else
    {
        TCHAR	szFolderPath[MAX_PATH] = { 0 };

        BROWSEINFO		sInfo;
        ::ZeroMemory(&sInfo, sizeof(BROWSEINFO));
        sInfo.pidlRoot = 0;
        sInfo.lpszTitle = _T("请选择一个文件夹：");
        sInfo.ulFlags = BIF_DONTGOBELOWDOMAIN | BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_EDITBOX;
        sInfo.lpfn = NULL;

        // 显示文件夹选择对话框
        LPITEMIDLIST lpidlBrowse = ::SHBrowseForFolder(&sInfo);
        if (lpidlBrowse != NULL)
        {
            // 取得文件夹名
            if (::SHGetPathFromIDList(lpidlBrowse, szFolderPath))
            {
                m_source = szFolderPath;
            }
        }
        if (lpidlBrowse != NULL)
        {
            ::CoTaskMemFree(lpidlBrowse);
        }
    }

    

    UpdateData(FALSE);
}


void CGlyphs2FontDlg::OnBnClickedButton2()
{
    // TODO: Add your control notification handler code here
    UpdateData(TRUE);

    TCHAR	szFolderPath[MAX_PATH] = { 0 };

    BROWSEINFO		sInfo;
    ::ZeroMemory(&sInfo, sizeof(BROWSEINFO));
    sInfo.pidlRoot = 0;
    sInfo.lpszTitle = _T("请选择一个文件夹：");
    sInfo.ulFlags = BIF_DONTGOBELOWDOMAIN | BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_EDITBOX;
    sInfo.lpfn = NULL;

    // 显示文件夹选择对话框
    LPITEMIDLIST lpidlBrowse = ::SHBrowseForFolder(&sInfo);
    if (lpidlBrowse != NULL)
    {
        // 取得文件夹名
        if (::SHGetPathFromIDList(lpidlBrowse, szFolderPath))
        {
            m_DestFolder = szFolderPath;
        }
    }
    if (lpidlBrowse != NULL)
    {
        ::CoTaskMemFree(lpidlBrowse);
    }

    UpdateData(FALSE);
}


void CGlyphs2FontDlg::OnBnClickedOk()
{
    // TODO: Add your control notification handler code here
    UpdateData(TRUE);

    makeFont();


    CDialogEx::OnOK();
}

void CGlyphs2FontDlg::makeFont(  )
{
    CHAR*  ansi  = NULL;
    CHAR*  ansi2 = NULL;
    CHAR*  ansi3 = NULL;
    CHAR  export_type[32] = { 0 };

    switch( m_export )
    {
    case 0:
        sprintf( export_type, "%s", "ttf" );
        break;
    case 1:
        sprintf( export_type, "%s", "otf" );
        break;
    case 2:
        sprintf( export_type, "%s", "var" );
        break;
    case 3:
        sprintf( export_type, "%s", "all" );
        break;
    }


    ansi  = m_source.GetBuffer();
    ansi2 = m_DestFolder.GetBuffer();
    ansi3 = m_familyName.GetBuffer();

    FILE* f = fopen("first.bat", "wb");
    fprintf( f, "packFont.exe \"%s\" \"%s\" \"%s\" \"%s\" \n", 
                ansi,
                export_type,
                ansi3,
                ansi2);
    fclose(f);
    m_source.ReleaseBuffer();
    m_DestFolder.ReleaseBuffer();
    m_familyName.ReleaseBuffer();

    system("first.bat  > log.txt 2>&1");
    
    DeleteFile("first.bat");
}