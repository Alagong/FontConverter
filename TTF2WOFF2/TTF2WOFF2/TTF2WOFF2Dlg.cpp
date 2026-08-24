
// TTF2WOFF2Dlg.cpp : implementation file
//

#include "pch.h"
#include "framework.h"
#include "TTF2WOFF2.h"
#include "TTF2WOFF2Dlg.h"
#include "afxdialogex.h"
#include <conio.h>

#include "FileHelper.h"
#include <woff2/encode.h>

#ifdef _DEBUG
#define new DEBUG_NEW
#endif

#define  FILE_ERROR   "error.txt"

#if 1
#define  LOCK()     EnterCriticalSection( &cs )
#define  UNLOCK()   LeaveCriticalSection( &cs )
#else
#define LOCK()
#define UNLOCK()
#endif

#define  LLOG( FMT, ... )       \
{                               \
    LOCK(  );                   \
    _cprintf( "\n" );           \
    _cprintf(FMT, __VA_ARGS__); \
    UNLOCK(  );                 \
}
    
#define  LERROR( FMT, ... )               \
{                                         \
    LOCK();                               \
    FILE* f = fopen(FILE_ERROR, "ab");    \
    char buffer[256] = {0};               \
    sprintf( buffer, FMT, __VA_ARGS__ );  \
    fwrite( buffer, 1, strlen(buffer), f);\
    fclose( f );                          \
    UNLOCK();                             \
}

typedef struct ThreadParam_
{
    CTTF2WOFF2Dlg*           pThis;
    UINT32                   tag;
    std::vector< FileName >  files;
}ThreadParam;



using namespace std;

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


// CTTF2WOFF2Dlg dialog



CTTF2WOFF2Dlg::CTTF2WOFF2Dlg(CWnd* pParent /*=nullptr*/)
	: CDialogEx(IDD_TTF2WOFF2_DIALOG, pParent)
    , m_isSingle(FALSE)
    , m_srcFolder(_T(""))
    , m_dstFolder(_T(""))
{
	m_hIcon = AfxGetApp()->LoadIcon(IDR_MAINFRAME);


    AllocConsole();
    InitializeCriticalSection( &cs );
}

CTTF2WOFF2Dlg::~CTTF2WOFF2Dlg()
{
    FreeConsole();
}

void CTTF2WOFF2Dlg::DoDataExchange(CDataExchange* pDX)
{
    CDialogEx::DoDataExchange(pDX);
    DDX_Radio(pDX, IDC_RADIO1, m_isSingle);
    DDX_Text(pDX, IDC_EDIT1, m_srcFolder);
    DDX_Text(pDX, IDC_EDIT2, m_dstFolder);
}

BEGIN_MESSAGE_MAP(CTTF2WOFF2Dlg, CDialogEx)
	ON_WM_SYSCOMMAND()
	ON_WM_PAINT()
	ON_WM_QUERYDRAGICON()
    ON_BN_CLICKED(IDC_BUTTON1, &CTTF2WOFF2Dlg::OnBnClickedButton1)
    ON_BN_CLICKED(IDC_BUTTON2, &CTTF2WOFF2Dlg::OnBnClickedButton2)
    ON_BN_CLICKED(IDOK, &CTTF2WOFF2Dlg::OnBnClickedOk)
END_MESSAGE_MAP()


// CTTF2WOFF2Dlg message handlers

BOOL CTTF2WOFF2Dlg::OnInitDialog()
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

void CTTF2WOFF2Dlg::OnSysCommand(UINT nID, LPARAM lParam)
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

void CTTF2WOFF2Dlg::OnPaint()
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
HCURSOR CTTF2WOFF2Dlg::OnQueryDragIcon()
{
	return static_cast<HCURSOR>(m_hIcon);
}



void CTTF2WOFF2Dlg::OnBnClickedButton1()
{
    UpdateData(TRUE);

    if (m_isSingle)
    {
        TCHAR			szFilePath[MAX_PATH] = { 0 };

        CFileDialog    dlgFile(TRUE, NULL, NULL, OFN_HIDEREADONLY, _T("Image Files (*.ttf)|*.ttf|All Files (*.*)|*.*||"), NULL);
        if (dlgFile.DoModal() == IDOK)
        {
            m_filePath = dlgFile.GetPathName();
            UpdateData(FALSE);
        }
        else
            m_filePath = _T("");

        m_srcFolder = m_filePath;
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
                m_srcFolder = szFolderPath;
            }
        }
        if (lpidlBrowse != NULL)
        {
            ::CoTaskMemFree(lpidlBrowse);
        }
    }
    
    UpdateData(FALSE);
}


void CTTF2WOFF2Dlg::OnBnClickedButton2()
{
    // TODO: Add your control notification handler code here
    UpdateData(TRUE);

    TCHAR			szFolderPath[MAX_PATH] = { 0 };

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
            m_dstFolder = szFolderPath;
        }
    }
    if (lpidlBrowse != NULL)
    {
        ::CoTaskMemFree(lpidlBrowse);
    }
    
    UpdateData(FALSE);
}



void CTTF2WOFF2Dlg::CopyDirecotyTree( CString& srcFolder, CString& dstFolder )
{
    CString     fdPath = _T("");
    CString myDataPath = srcFolder + "\\*.*";
    CString strTmp;
    CFileFind find;
    BOOL bf = find.FindFile(myDataPath);

    while (bf)
    {
        bf = find.FindNextFile();
        if (!find.IsDots())
        {
            fdPath = find.GetFilePath();

            if (find.IsDirectory())
            {
                int pos = srcFolder.GetLength();
                CString relativePath = fdPath.Mid(pos);
                CString tmp_dstFolder = dstFolder + relativePath;

                if (!PathIsDirectory(tmp_dstFolder))
                    ::CreateDirectory(tmp_dstFolder, NULL);

                CopyDirecotyTree(fdPath, tmp_dstFolder);
            }
        }
    }
    find.Close();
}


void CTTF2WOFF2Dlg::ScanFiles(CString& folder, vector< FileName >& container)
{
    CString     fdPath = _T("");
    CString myDataPath = folder + "\\*.*";
    CString strTmp;
    CFileFind find;
    BOOL bf = find.FindFile(myDataPath);

    while (bf)
    {
        bf = find.FindNextFile();
        if (!find.IsDots())
        {
            fdPath = find.GetFilePath();

            if (find.IsDirectory())
            {
                ScanFiles(fdPath, container);
            }
            else
            {
                CString name = find.GetFileName();
                strTmp = fdPath.Right(4);
                strTmp.MakeLower();
                if (strTmp == ".ttf")
                {
                    FileName  fn = { fdPath, name };
                    container.push_back(fn);
                }
            }
        }
    }
    find.Close();
}


CString CTTF2WOFF2Dlg::GetFileName(CString& path, CString& ExtendName)
{
    int Where;
    Where = path.ReverseFind('//');
    if (Where == -1)
        Where = path.ReverseFind('/');

    CString FileTitle = path.Right(path.GetLength() - 1 - Where);

    int Which = FileTitle.ReverseFind('.');

    ExtendName = FileTitle.Right(FileTitle.GetLength() - Which - 1);

    if (Which != -1)
        FileTitle = FileTitle.Left(Which);

    return FileTitle;
}

bool CTTF2WOFF2Dlg::ConvertFont( CString& src, CString& dst )
{
    bool ret = false;

    // 把文件读进内存
    src.GetBuffer();
    LLOG( _T("Reading File ...  path = %s"), src.GetBuffer() );

    unsigned char*  src_data = NULL;
    size_t          src_len  = 0;
    if (false == FileHelper::ReadFile(src, &src_data, &src_len))
    {
        LERROR( _T("读取图像文件失败！") );
        return  false;
    }

    // 转换
    LLOG( _T("Converting ...") );
    uint8_t*   dst_data = NULL;
    size_t     dst_len  = woff2::MaxWOFF2CompressedSize( src_data, src_len );

    dst_data = (uint8_t*)calloc( 1, dst_len );
    if( !dst_data )
    {
        LERROR( _T("内存申请失败！") );
        free( src_data );
        return  false;
    }

    ret = woff2::ConvertTTFToWOFF2( src_data, src_len, dst_data, &dst_len );

    if( ret )
    {
        LLOG( _T("Writing File ... path = %s"), dst.GetBuffer() );
        FileHelper::WriteFile( dst, dst_data, dst_len );
    }
    else
    {
        LERROR( _T("转换失败") );
    }

    if( src_data )    free( src_data );
    if( dst_data )    free( dst_data );

    return ret;
}

void CTTF2WOFF2Dlg::OnBnClickedOk()
{
    // TODO: Add your control notification handler code here
    UpdateData(TRUE);

    if (m_isSingle)
    {
        // 生成保存文件路径
        int nPos = m_filePath.ReverseFind('\\'); 
        CString csFileFullName;
        csFileFullName = m_filePath.Right(m_filePath.GetLength() - nPos - 1);
        CString extend = _T("");
        CString fileName = GetFileName(csFileFullName, extend);

        CString dstName = m_dstFolder;
        dstName.Append(_T("\\"));
        dstName.Append(fileName);
        dstName.Append(_T(".woff2"));

        // 转换
        ConvertFont( m_filePath, dstName );
    }
    else
    {
        vector< FileName > files;
        ScanFiles(m_srcFolder, files);
        CopyDirecotyTree(m_srcFolder, m_dstFolder);

        LONG  count = files.size();
        if( count == 0 )
            return;

        // 开启线程
        LONG  nThreads = count >= NUM_THREAD ? NUM_THREAD : count;
        LONG  count_per_thread = count / nThreads;
        std::vector< ThreadParam > thread_params( nThreads );
        LONG  offset = 0;
        const FileName*  pData = files.data();
        for( LONG i=0; i < nThreads; i++ )
        {
            thread_params[i].pThis = this;
            thread_params[i].tag   = i;

            if( i + 1 < nThreads )
                thread_params[i].files = { pData + offset, pData + offset + count_per_thread };
            else
                thread_params[i].files = { pData + offset, pData + count };

            ::AfxBeginThread( ThreadFun, &thread_params[i] );
            offset += count_per_thread;
        }

        while( TRUE )
        {
            BOOL  finish = TRUE;

            for( LONG i=0; i < nThreads; i++ )
            {
                if( thread_status[i] == 0 )
                {
                    finish = FALSE;
                    break;
                }
            }

            if( finish )
                break;
            else
                Sleep( 1000 );
        }
    }

    ::AfxMessageBox(_T("完成！"));
    CDialogEx::OnOK();
}


void  CTTF2WOFF2Dlg::thread_finish( UINT32 tag )
{
    if( tag >= NUM_THREAD )
        return;

    thread_status[tag] = 1;
}

UINT CTTF2WOFF2Dlg::ThreadFun(LPVOID param )
{
    ThreadParam* tp = (ThreadParam*)param;

    if( !tp )
        return 0;

    CTTF2WOFF2Dlg*            pThis = tp->pThis;
    std::vector< FileName >&  files = tp->files;

    LONG  count = files.size();

    CString  relativePath, extend, fileName, dstPath;
    for( LONG i=0; i < count; i++ )
    {
        CString src_path = files[i].filePath;

        int pos = pThis->m_srcFolder.GetLength();
        relativePath = src_path.Mid(pos);
        extend   = _T("");
        fileName = pThis->GetFileName(relativePath, extend);
        dstPath  = pThis->m_dstFolder + relativePath;

        int nPos = dstPath.ReverseFind('.'); 
        dstPath = dstPath.Left(nPos);
        dstPath.Append( _T(".woff2") );

        pThis->ConvertFont( src_path, dstPath );
    }

    pThis->thread_finish( tp->tag );

    return 0;
}
