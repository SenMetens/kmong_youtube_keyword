import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Baby, BarChart3, CalendarDays,
  Check, ChevronDown, Clapperboard, Clock3, CloudCheck, Cpu,
  Database, Download, ExternalLink, Eye, FileSpreadsheet, Flame, Gamepad2, GraduationCap,
  Hash, Heart, HelpCircle, Home, LayoutGrid, Link2, LogOut, Menu, MessageCircle, Music2,
  Newspaper, Palette, Plane, Play, PlayCircle, RefreshCw, Search, Settings, SlidersHorizontal,
  ShoppingBag, Sparkles, Trash2, Trophy, TrendingUp, UserRound, Utensils, WalletCards, X, Zap,
  Copy, KeyRound, UserPlus,
} from 'lucide-react';
import { categories, enrichVideo, videos as sampleVideos } from './data';
import { isSupabaseConfigured } from './lib/supabase';
import {
  analyzeYoutubeVideo,
  clearYoutubeKeywordMasterAnalyses,
  deleteAccessCode,
  fetchYoutubeKeywordMasterAnalyses,
  fetchYoutubeKeywordMasterData,
  issueAccessCode,
  listAccessCodes,
  resetCodeDevices,
  saveYoutubeTranscript,
  setAccessCodeActive,
  setCodeMaxDevices,
  verifyAccessCode,
} from './services/youtubeDataService';

// 자막 도우미 크롬 확장(extension 폴더)에 추출을 요청한다.
// 확장이 설치되지 않은 브라우저에서는 응답이 없을 뿐 아무 영향이 없다.
const requestTranscriptViaExtension = (videoId) => {
  window.postMessage({ type: 'YKM_TRANSCRIPT_REQUEST', videoId }, window.location.origin);
};

// 브라우저(기기)를 기억하는 토큰. 최초 1회 생성해 localStorage에 보관하고,
// 같은 브라우저에서는 재인증 없이 서버 검증만 갱신한다.
const getDeviceId = () => {
  try {
    let id = localStorage.getItem('ykm-device-id');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('ykm-device-id', id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

const iconMap = {
  LayoutGrid, Flame, Clapperboard, Music2, Gamepad2, Trophy, Newspaper, GraduationCap,
  Cpu, Plane, Palette, UserRound, Utensils, WalletCards, Sparkles, Baby, ShoppingBag,
};
const categoryLabels = Object.fromEntries(categories.map((category) => [category.id, category.label]));
const navItems = [
  { id: 'main', label: '메인', icon: Home },
  { id: 'analysis', label: '분석 결과', icon: BarChart3 },
  { id: 'settings', label: '문의', icon: Settings },
];

const formatNumber = (value) => new Intl.NumberFormat('ko-KR').format(value);
const compactNumber = (value) => {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}만`;
  return formatNumber(value);
};

const videoDurationSeconds = (video) => {
  if (video.durationSeconds) return Number(video.durationSeconds);
  return String(video.duration || '').split(':').reduce((total, part) => total * 60 + Number(part || 0), 0);
};
// 유튜브 쇼츠 최대 길이(현재 3분). 세로여도 이보다 길면 라이브/롱폼이므로 쇼츠가 아니다.
const SHORTS_MAX_SECONDS = 180;
const isShortVideo = (video) => {
  const seconds = videoDurationSeconds(video);
  // 길이가 3분을 넘으면 세로 영상이라도 쇼츠에서 제외한다(세로 라이브·롱폼 오분류 방지).
  if (seconds > SHORTS_MAX_SECONDS) return false;
  // 수집 시 저장된 세로/가로 판별 값을 우선 사용한다 (세로 + 짧은 길이 = Shorts).
  if (typeof video.isShort === 'boolean') return video.isShort;
  // 판별 전 데이터는 길이 휴리스틱(60초 이하)으로 임시 분류하고, 다음 수집에서 갱신된다.
  return seconds > 0 && seconds <= 60;
};

const sortOptions = [
  { value: 'growth_desc', label: '조회 증가 높은 순' },
  { value: 'growth_asc', label: '조회 증가 낮은 순' },
  { value: 'views_desc', label: '누적 조회 높은 순' },
  { value: 'views_asc', label: '누적 조회 낮은 순' },
  { value: 'likes_desc', label: '좋아요 증가 높은 순' },
  { value: 'likes_asc', label: '좋아요 증가 낮은 순' },
  { value: 'published_desc', label: '등록 일자 최신순' },
  { value: 'published_asc', label: '등록 일자 오래된순' },
];
const sortCriterion = (value) => String(value || '').split('_')[0];

const compareVideos = (left, right, sortValue) => {
  const [criterion, direction] = String(sortValue || '').split('_');
  let result = 0;
  if (criterion === 'published') {
    const leftDate = new Date(new Date(left.publishedAt || 0).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rightDate = new Date(new Date(right.publishedAt || 0).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    result = rightDate.localeCompare(leftDate);
  }
  if (criterion === 'views') result = right.views - left.views;
  if (criterion === 'likes') result = right.likeDelta - left.likeDelta;
  if (criterion === 'growth') result = right.viewDelta - left.viewDelta;
  return direction === 'asc' ? -result : result;
};

const xmlEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
const excelColumn = (index) => {
  let result = '';
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) result = String.fromCharCode(65 + ((current - 1) % 26)) + result;
  return result;
};

async function createXlsx(rows) {
  const { strToU8, zipSync } = await import('fflate');
  const headers = ['채널명', '영상 제목', '링크', '영상 길이', '등록 일자', '조회수', '좋아요', '댓글 개수', '해시태그', '스크립트', '댓글 TOP 1', '댓글 TOP 2', '댓글 TOP 3'];
  const widths = [18, 44, 42, 12, 14, 14, 12, 12, 30, 60, 55, 55, 55];
  const data = [headers, ...rows];
  const sheetRows = data.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${excelColumn(columnIndex)}${rowIndex + 1}`;
      if (typeof value === 'number') return `<c r="${reference}"${rowIndex === 0 ? ' s="1"' : ''}><v>${value}</v></c>`;
      return `<c r="${reference}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="24" customHeight="1"' : ''}>${cells}</row>`;
  }).join('');
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="분석 결과" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEF4444"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])), { level: 6 });
}

const shortUserAgent = (ua) => {
  if (!ua) return '브라우저 미상';
  const browser = /Edg/.test(ua) ? 'Edge' : /OPR|Opera/.test(ua) ? 'Opera' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '기타';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
};
const formatDeviceTime = (value) => {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(value));
  } catch {
    return '-';
  }
};

function AccessGate({ deviceId, onVerified }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const inputsRef = useRef([]);
  const code = digits.join('');

  const setDigit = (index, value) => {
    const clean = value.replace(/\D/g, '');
    setDigits((current) => {
      const next = [...current];
      if (!clean) { next[index] = ''; return next; }
      // 첫 칸에 전체 코드를 붙여넣는 경우를 지원한다.
      clean.split('').forEach((char, offset) => { if (index + offset < 6) next[index + offset] = char; });
      return next;
    });
    if (clean) inputsRef.current[Math.min(index + clean.length, 5)]?.focus();
  };

  const onKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) inputsRef.current[index - 1]?.focus();
  };

  const submit = async () => {
    if (code.length !== 6 || status === 'loading') return;
    setStatus('loading');
    setMessage('');
    try {
      const result = await verifyAccessCode(code, deviceId);
      if (result.ok) { onVerified(code, result.isAdmin, result.label); return; }
      setStatus('error');
      setMessage(
        result.reason === 'device_limit' ? '등록 가능한 기기 수를 초과했어요. 관리자에게 문의해주세요.'
          : result.reason === 'expired' ? '만료된 코드예요. 관리자에게 문의해주세요.'
            : '코드가 올바르지 않아요. 다시 확인해주세요.',
      );
    } catch (error) {
      console.error('Video analysis failed:', error);
      setStatus('error');
      setMessage('확인 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
    }
  };

  useEffect(() => { inputsRef.current[0]?.focus(); }, []);
  // 6자리가 채워지면 자동으로 확인을 시도한다.
  useEffect(() => { if (code.length === 6 && status !== 'loading') submit(); }, [code]);

  return (
    <div className="access-gate">
      <div className="access-card">
        <span className="scan-logo"><Play fill="currentColor" size={20} /></span>
        <h2>접근 코드 입력</h2>
        <p>서비스 이용을 위해 발급받은 6자리 코드를 입력해주세요.</p>
        <div className={`code-inputs ${status === 'error' ? 'error' : ''}`}>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => { inputsRef.current[index] = element; }}
              value={digit}
              onChange={(event) => setDigit(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              inputMode="numeric"
              maxLength={index === 0 ? 6 : 1}
              aria-label={`코드 ${index + 1}번째 자리`}
            />
          ))}
        </div>
        {message && <div className="code-error">{message}</div>}
        <button className="code-submit" onClick={submit} disabled={code.length !== 6 || status === 'loading'}>
          {status === 'loading' ? <RefreshCw className="spin" size={17} /> : <Check size={17} />}
          확인
        </button>
      </div>
    </div>
  );
}

function AdminPage({ auth }) {
  const [label, setLabel] = useState('');
  const [maxDevices, setMaxDevices] = useState(2);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null);
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState('');

  const refresh = () => {
    setLoading(true);
    listAccessCodes(auth)
      .then((list) => { setCodes(list); setError(''); })
      .catch(() => setError('목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  const issue = async () => {
    if (issuing) return;
    setIssuing(true);
    setIssued(null);
    setError('');
    try {
      const result = await issueAccessCode(auth, label.trim(), Number(maxDevices) || 2);
      setIssued({ code: result.code, label: result.label });
      setLabel('');
      refresh();
    } catch {
      setError('코드 발급에 실패했습니다.');
    } finally {
      setIssuing(false);
    }
  };

  const toggleActive = async (targetCode, next) => {
    try {
      await setAccessCodeActive(auth, targetCode, next);
      setCodes((current) => current.map((item) => (item.code === targetCode ? { ...item, is_active: next } : item)));
    } catch {
      setError('상태 변경에 실패했습니다.');
    }
  };

  const changeMaxLocal = (targetCode, value) => {
    setCodes((current) => current.map((item) => (item.code === targetCode ? { ...item, max_devices: value } : item)));
  };
  const saveMax = async (targetCode, value) => {
    const clamped = Math.max(1, Math.min(50, Number(value) || 1));
    setCodes((current) => current.map((item) => (item.code === targetCode ? { ...item, max_devices: clamped } : item)));
    try {
      await setCodeMaxDevices(auth, targetCode, clamped);
    } catch {
      setError('기기 수 수정에 실패했습니다.');
      refresh();
    }
  };
  const resetDevices = async (targetCode) => {
    if (!window.confirm('이 코드에 연결된 모든 기기를 초기화할까요? 사용자는 코드를 다시 입력해 재등록해야 합니다.')) return;
    try {
      await resetCodeDevices(auth, targetCode);
      setCodes((current) => current.map((item) => (item.code === targetCode ? { ...item, devices: [] } : item)));
    } catch {
      setError('기기 초기화에 실패했습니다.');
    }
  };
  const removeCode = async (targetCode) => {
    if (!window.confirm(`코드 ${targetCode}를 삭제할까요? 이 코드로는 더 이상 접속할 수 없고, 연결된 기기 기록도 함께 삭제됩니다.`)) return;
    try {
      await deleteAccessCode(auth, targetCode);
      setCodes((current) => current.filter((item) => item.code !== targetCode));
    } catch {
      setError('코드 삭제에 실패했습니다.');
    }
  };

  const copyCode = (value) => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const keyword = search.trim().toLowerCase();
  const filteredCodes = keyword
    ? codes.filter((item) => `${item.code} ${item.label || ''}`.toLowerCase().includes(keyword))
    : codes;

  return (
    <main className="page-content">
      <section className="page-heading">
        <div><div className="eyebrow">ADMIN</div><h1>코드 관리</h1><p>사용자에게 전달할 접근 코드를 발급하고, 접속 기기와 IP를 확인하세요.</p></div>
        <button className="icon-btn" onClick={refresh} aria-label="새로고침"><RefreshCw size={18} /></button>
      </section>

      <section className="admin-issue">
        <div className="admin-issue-form">
          <label className="admin-field"><span>닉네임</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="예: 홍길동 고객" maxLength={60} /></label>
          <label className="admin-field small"><span>허용 기기 수</span><input type="number" min={1} max={50} value={maxDevices} onChange={(event) => setMaxDevices(event.target.value)} /></label>
          <button className="primary-button" onClick={issue} disabled={issuing}>{issuing ? <RefreshCw className="spin" size={17} /> : <UserPlus size={17} />} 코드 발급</button>
        </div>
        {issued && (
          <div className="admin-issued">
            <div><span>발급된 코드{issued.label ? ` · ${issued.label}` : ''}</span><strong>{issued.code}</strong></div>
            <button onClick={() => copyCode(issued.code)}><Copy size={15} /> {copied ? '복사됨' : '복사'}</button>
          </div>
        )}
      </section>

      {error && <div className="admin-error">{error}</div>}

      <section className="admin-codes">
        <div className="admin-codes-head">
          <h2>발급된 코드</h2>
          <div className="admin-codes-tools">
            <label className="admin-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="닉네임·코드 검색" /></label>
            <span>{keyword ? `${filteredCodes.length}/${codes.length}` : `${codes.length}개`}</span>
          </div>
        </div>
        {loading ? (
          <div className="admin-empty"><RefreshCw className="spin" size={20} /><span>불러오는 중...</span></div>
        ) : codes.length === 0 ? (
          <div className="admin-empty"><KeyRound size={22} /><span>아직 발급한 코드가 없습니다.</span></div>
        ) : filteredCodes.length === 0 ? (
          <div className="admin-empty"><Search size={22} /><span>검색 결과가 없습니다.</span></div>
        ) : (
          filteredCodes.map((item) => (
            <article className={`admin-code-row ${item.is_active ? '' : 'inactive'}`} key={item.code}>
              <div className="admin-code-main">
                <div className="admin-code-id"><strong>{item.code}</strong><span>{item.label || '이름 없음'}</span></div>
                <div className="admin-code-meta">
                  <label className="admin-max">기기 {item.devices.length} /
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={item.max_devices}
                      onChange={(event) => changeMaxLocal(item.code, event.target.value)}
                      onBlur={(event) => saveMax(item.code, event.target.value)}
                      aria-label="허용 기기 수"
                    />
                  </label>
                  <button className="admin-reset" onClick={() => resetDevices(item.code)}>기기 초기화</button>
                  <button className={`admin-toggle ${item.is_active ? 'on' : 'off'}`} onClick={() => toggleActive(item.code, !item.is_active)}>{item.is_active ? '사용중' : '중지됨'}</button>
                  <button className="admin-delete" onClick={() => removeCode(item.code)} aria-label="코드 삭제"><Trash2 size={15} /></button>
                </div>
              </div>
              {item.devices.length > 0 && (
                <div className="admin-devices">
                  {item.devices.map((device, index) => (
                    <div className="admin-device" key={index}>
                      <span className="admin-device-ip">{device.ip || 'IP 미상'}</span>
                      <span className="admin-device-ua">{shortUserAgent(device.user_agent)}</span>
                      <span className="admin-device-time">{formatDeviceTime(device.last_seen)}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}

function Logo({ compact = false }) {
  return (
    <div className={`logo ${compact ? 'compact' : ''}`}>
      <span className="logo-mark"><Play fill="currentColor" size={18} /></span>
      {!compact && <span><strong>Keyword</strong><small>MASTER</small></span>}
    </div>
  );
}

function Sidebar({ activeCategory, setActiveCategory, mobileOpen, closeMobile, videoItems }) {
  const fastestCategory = categories
    .filter((category) => category.id !== 'all' && category.id !== 'trending')
    .map((category) => {
      const categoryVideos = videoItems.filter((video) => video.category === category.id);
      const growth = categoryVideos.reduce((sum, video) => sum + video.viewDelta, 0);
      return { ...category, growth };
    })
    .sort((a, b) => b.growth - a.growth)[0];

  return (
    <>
      <div className={`mobile-backdrop ${mobileOpen ? 'show' : ''}`} onClick={closeMobile} />
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-head">
          <Logo />
          <button className="icon-btn mobile-only" onClick={closeMobile} aria-label="메뉴 닫기"><X size={20} /></button>
        </div>
        <div className="category-title"><span>YOUTUBE CATEGORY</span><SlidersHorizontal size={14} /></div>
        <nav className="category-list" aria-label="유튜브 카테고리">
          {categories.map((category) => {
            const Icon = iconMap[category.icon];
            const count = category.id === 'all' ? videoItems.filter((video) => video.category !== 'trending').length : videoItems.filter((video) => video.category === category.id).length;
            return (
              <button
                key={category.id}
                className={activeCategory === category.id ? 'active' : ''}
                onClick={() => { setActiveCategory(category.id); closeMobile(); }}
              >
                <span className="category-label"><Icon size={18} />{category.label}</span>
                <span className="category-count">{count}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-tip">
          <span className="tip-icon"><Sparkles size={17} /></span>
          <strong>오늘의 인사이트</strong>
          <p>{fastestCategory?.growth > 0 ? `${fastestCategory.label} 카테고리의 조회수 증가가 가장 커요.` : '두 번째 수집부터 직전 수집 대비 성장 신호를 알려드려요.'}</p>
          {fastestCategory?.growth > 0 && <button onClick={() => setActiveCategory(fastestCategory.id)}>확인하기 <ArrowRight size={13} /></button>}
        </div>
        <div className="sidebar-foot"><HelpCircle size={16} /><span>도움말 및 가이드</span></div>
      </aside>
    </>
  );
}

function Header({ activeTab, setActiveTab, analysisCount, openMobile, isAdmin, nickname, onLogout }) {
  const items = isAdmin ? [...navItems, { id: 'admin', label: '코드 관리', icon: KeyRound }] : navItems;
  return (
    <header className="topbar">
      <button className="icon-btn menu-button" onClick={openMobile} aria-label="메뉴 열기"><Menu size={21} /></button>
      <nav className="top-nav" aria-label="주요 메뉴">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={activeTab === item.id ? 'active' : ''} onClick={() => setActiveTab(item.id)}>
              <Icon size={17} /><span>{item.label}</span>
              {item.id === 'analysis' && analysisCount > 0 && <em>{analysisCount}</em>}
            </button>
          );
        })}
      </nav>
      <div className="header-actions">
        {nickname && <span className="profile-name">{nickname}</span>}
        <button className="logout-button" type="button" onClick={onLogout}><LogOut size={15} /> 로그아웃</button>
      </div>
    </header>
  );
}

function QuotaGauge({ label, remaining, total, unit }) {
  const ratio = total > 0 ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) : 0;
  return (
    <div className={`quota-card ${ratio <= 15 ? 'low' : ''}`}>
      <small>{label}</small>
      <strong>{formatNumber(remaining)}<span> / {formatNumber(total)}{unit}</span></strong>
      <div className="quota-gauge"><span style={{ width: `${ratio}%` }} /></div>
    </div>
  );
}

function Trend({ value, tone }) {
  if (!value) return <span className="trend flat">-</span>;
  const Arrow = value > 0 ? ArrowUp : ArrowDown;
  return <span className={`trend ${tone}`}><Arrow size={13} /> {compactNumber(Math.abs(value))}</span>;
}

function SummaryCard({ icon: Icon, tone, label, value, meta }) {
  return (
    <div className="summary-card">
      <span className={`summary-icon ${tone}`}><Icon size={20} /></span>
      <div><span>{label}</span><strong>{value}</strong><small><TrendingUp size={12} /> {meta}</small></div>
    </div>
  );
}

function VideoTable({ data, onAnalyze, rankOffset = 0 }) {
  return (
    <div className="video-table-wrap">
      <table className="video-table">
        <thead><tr><th>순위</th><th>인기 영상</th><th>카테고리</th><th>누적 조회수</th><th>조회수</th><th>좋아요</th><th>업로드</th><th aria-label="분석" /></tr></thead>
        <tbody>
          {data.map((video, index) => (
            <tr key={`${video.category}-${video.id}`} onClick={() => onAnalyze(video)}>
              <td><span className={`rank ${index + rankOffset < 3 ? `top-${index + rankOffset + 1}` : ''}`}>{index + rankOffset + 1}</span></td>
              <td>
                <div className="video-cell">
                  <div className="thumb"><img src={video.thumbnail} alt="" /><span><Clock3 size={10} />{video.duration}</span><div className="play-cover"><Play fill="currentColor" size={16} /></div></div>
                  <div><strong>{video.title}</strong><span className="video-meta">{video.channel}<em className={isShortVideo(video) ? 'shorts' : 'regular'}>{isShortVideo(video) ? 'Shorts' : '일반 영상'}</em></span></div>
                </div>
              </td>
              <td><span className="category-badge">{categoryLabels[video.category] || video.category}</span></td>
              <td><strong className="metric-main">{compactNumber(video.views)}</strong></td>
              <td><Trend value={video.viewDelta} tone={video.viewDelta > 0 ? 'red' : video.viewDelta < 0 ? 'blue' : 'flat'} /></td>
              <td><Trend value={video.likeDelta} tone={video.likeDelta > 0 ? 'red' : video.likeDelta < 0 ? 'blue' : 'flat'} /></td>
              <td><span className="date-cell">{video.published.replace('2026. ', '').replace(/\.\s*$/, '')}</span></td>
              <td><button className="analyze-button" onClick={(event) => { event.stopPropagation(); onAnalyze(video); }}><Zap size={15} /> 분석</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MainDashboard({ activeCategory, onAnalyze, videoItems, summary, dataStatus, dataError, onCheckShorts }) {
  const [query, setQuery] = useState('');
  const [primarySort, setPrimarySort] = useState('growth_desc');
  const [secondarySort, setSecondarySort] = useState('none');
  const [videoType, setVideoType] = useState('all');
  const [page, setPage] = useState(1);
  const selectedCategory = categories.find((category) => category.id === activeCategory);
  const filtered = useMemo(() => {
    // '전체'에서는 급상승 차트를 제외해 같은 영상이 두 번 나오지 않게 한다.
    const byCategory = activeCategory === 'all' ? videoItems.filter((video) => video.category !== 'trending') : videoItems.filter((video) => video.category === activeCategory);
    const byType = videoType === 'all' ? byCategory : byCategory.filter((video) => videoType === 'shorts' ? isShortVideo(video) : !isShortVideo(video));
    const byQuery = byType.filter((video) => `${video.title} ${video.channel}`.toLowerCase().includes(query.toLowerCase()));
    return [...byQuery].sort((a, b) => compareVideos(a, b, primarySort) || compareVideos(a, b, secondarySort) || b.views - a.views);
  }, [activeCategory, primarySort, query, secondarySort, videoItems, videoType]);
  const totalViews = filtered.reduce((sum, video) => sum + video.views, 0);
  const totalGrowth = filtered.reduce((sum, video) => sum + video.viewDelta, 0);
  const avgGrowth = filtered.length ? Math.round(filtered.reduce((sum, video) => {
    const previousViews = video.views - video.viewDelta;
    return sum + (previousViews > 0 ? (video.viewDelta / previousViews) * 100 : 0);
  }, 0) / filtered.length) : 0;
  // 하루 안전 한도(서버 reserve_api_quota와 동일: 8,000유닛). 분석 1회 = 3유닛(영상+채널+댓글).
  const apiUnitsLimit = Number(summary.api_units_limit || 8000);
  const apiUnitsRemaining = Math.max(0, apiUnitsLimit - Number(summary.api_units_used || 0));
  const analysisLimit = Math.floor(apiUnitsLimit / 3);
  const analysisRemaining = Math.floor(apiUnitsRemaining / 3);
  const lastCollectedLabel = summary.last_collected_at
    ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(summary.last_collected_at))
    : '수집 대기 중';
  const snapshotDateLabel = filtered[0]?.snapshotDate
    ? new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(`${filtered[0].snapshotDate}T00:00:00+09:00`))
    : '아직 수집된 데이터 없음';
  const emptyTitle = dataStatus === 'loading' ? '실제 YouTube 데이터를 불러오는 중입니다' : dataStatus === 'error' ? 'Supabase 데이터를 불러오지 못했습니다' : query ? '검색 결과가 없습니다' : videoType !== 'all' ? '해당 영상 유형이 없습니다' : '아직 수집된 영상이 없습니다';
  const emptyDescription = dataStatus === 'error' ? dataError : query ? '다른 검색어를 입력해보세요.' : videoType !== 'all' ? '다른 영상 유형을 선택해보세요.' : '첫 데이터 수집이 완료되면 이곳에 표시됩니다.';
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [activeCategory, primarySort, query, secondarySort, videoType]);

  // 쇼츠 필터에서 보이는 영상들을 확장으로 실제 쇼츠인지 검증해 오분류를 걸러낸다.
  const shortsPageKey = pageItems.map((video) => video.id).join(',');
  useEffect(() => {
    if (videoType === 'shorts' && pageItems.length) onCheckShorts?.(pageItems.map((video) => video.id));
  }, [videoType, shortsPageKey, onCheckShorts]);

  return (
    <main className="page-content">
      <section className="page-heading">
        <div>
          <div className="eyebrow"><span className="live-dot" /> LIVE TREND · SOUTH KOREA</div>
          <h1>{selectedCategory.label} 인기 영상</h1>
          <p>직전 수집보다 빠르게 성장한 영상을 발견하고, 콘텐츠 기회를 분석하세요.</p>
        </div>
        <div className="status-cluster">
          <QuotaGauge label="오늘 호출 한도" remaining={apiUnitsRemaining} total={apiUnitsLimit} unit=" 유닛" />
          <QuotaGauge label="오늘 분석 한도" remaining={analysisRemaining} total={analysisLimit} unit="회" />
          <div className="sync-status"><span><CloudCheck size={18} /></span><div><small>최근 데이터 수집</small><strong>{lastCollectedLabel}</strong></div><button aria-label="데이터 새로고침" onClick={() => window.location.reload()}><RefreshCw size={16} /></button></div>
        </div>
      </section>

      <section className="summary-grid">
        <SummaryCard icon={PlayCircle} tone="red" label="수집된 인기 영상" value={`${filtered.length}개`} meta="4시간 주기 업데이트" />
        <SummaryCard icon={Eye} tone="blue" label="합산 조회수" value={compactNumber(totalViews)} meta={`직전 수집보다 ${compactNumber(totalGrowth)} 증가`} />
        <SummaryCard icon={TrendingUp} tone="green" label="평균 성장률" value={`+${avgGrowth}%`} meta="직전 수집 대비" />
        <SummaryCard icon={Database} tone="purple" label="데이터 스냅샷" value={`${Number(summary.snapshot_days || 0)}일`} meta="하루 6회 최신화" />
      </section>

      <section className="content-card">
        <div className="card-toolbar">
          <div><h2>실시간 인기 TOP {filtered.length}</h2><p>영상을 클릭하면 상세 분석을 시작합니다.</p></div>
          <div className="table-tools">
            <div className="type-filter" aria-label="영상 유형 필터" title="세로 영상을 Shorts, 가로 영상을 일반 영상으로 분류합니다.">
              <button className={videoType === 'all' ? 'active' : ''} onClick={() => setVideoType('all')}>전체</button>
              <button className={videoType === 'regular' ? 'active' : ''} onClick={() => setVideoType('regular')}>일반 영상</button>
              <button className={videoType === 'shorts' ? 'active' : ''} onClick={() => setVideoType('shorts')}>Shorts</button>
            </div>
            <label className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="영상 또는 채널 검색" /></label>
            <label className="select-box"><span>1차</span><select value={primarySort} onChange={(e) => { const next = e.target.value; setPrimarySort(next); if (sortCriterion(secondarySort) === sortCriterion(next)) setSecondarySort('none'); }}>{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={14} /></label>
            <label className="select-box"><span>2차</span><select value={secondarySort} onChange={(e) => setSecondarySort(e.target.value)}><option value="none">사용 안 함</option>{sortOptions.map((option) => <option key={option.value} value={option.value} disabled={sortCriterion(primarySort) === sortCriterion(option.value)}>{option.label}</option>)}</select><ChevronDown size={14} /></label>
          </div>
        </div>
        {filtered.length > 0 ? <VideoTable data={pageItems} onAnalyze={onAnalyze} rankOffset={(page - 1) * pageSize} /> : <div className="empty-search"><Search size={28} /><strong>{emptyTitle}</strong><span>{emptyDescription}</span></div>}
        <div className="table-foot"><span><span className="status-dot" /> Supabase 저장 데이터 · {snapshotDateLabel}</span><div><button disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ArrowLeft size={15} /></button><strong title={`총 ${pageCount}페이지`}>{page}</strong><button disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ArrowRight size={15} /></button></div></div>
      </section>
    </main>
  );
}

function AnalysisPage({ analyses, onOpen, onExport, exportState, onReset, resetState }) {
  return (
    <main className="page-content">
      <section className="page-heading analysis-heading">
        <div><div className="eyebrow">MY ANALYSIS LIBRARY</div><h1>분석 결과</h1><p>분석한 영상의 핵심 데이터와 콘텐츠 인사이트를 한곳에서 관리하세요.</p></div>
        <div className="analysis-actions">
          <button className="danger-button" onClick={onReset} disabled={!analyses.length || resetState === 'loading'}>{resetState === 'loading' ? <RefreshCw className="spin" size={17} /> : <Trash2 size={17} />}분석 결과 초기화</button>
          <button className="primary-button" onClick={onExport} disabled={!analyses.length || exportState === 'loading'}>
            {exportState === 'done' ? <Check size={18} /> : exportState === 'loading' ? <RefreshCw className="spin" size={18} /> : <FileSpreadsheet size={18} />}
            {exportState === 'done' ? '저장 완료' : '추출 결과 저장하기'}
          </button>
        </div>
      </section>
      {analyses.length === 0 ? (
        <section className="empty-analysis">
          <div className="empty-illustration"><BarChart3 size={46} /><span><Sparkles size={17} /></span></div>
          <h2>아직 분석한 영상이 없어요</h2>
          <p>메인의 인기 영상 목록에서 관심 있는 영상을 클릭하면<br />채널, 댓글, 해시태그와 스크립트를 분석해드려요.</p>
        </section>
      ) : (
        <>
          <section className="analysis-summary">
            <div><span>분석한 영상</span><strong>{analyses.length}</strong><small>개</small></div>
            <div><span>전체 조회수</span><strong>{compactNumber(analyses.reduce((sum, item) => sum + item.views, 0))}</strong></div>
            <div><span>발견한 해시태그</span><strong>{analyses.reduce((sum, item) => sum + item.tags.length, 0)}</strong><small>개</small></div>
            <div className="excel-note"><FileSpreadsheet size={22} /><span>모든 항목을 Excel<br />파일로 저장할 수 있어요.</span></div>
          </section>
          <section className="analysis-list">
            <div className="analysis-list-head"><div><h2>저장된 분석</h2><p>최신 분석순으로 표시됩니다.</p></div><span>총 {analyses.length}개</span></div>
            {analyses.map((video, index) => (
              <article className="analysis-row" key={video.id} onClick={() => onOpen(video)}>
                <span className="analysis-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="analysis-thumb"><img src={video.thumbnail} alt="" /><span>{video.duration}</span></div>
                <div className="analysis-info"><span>{video.channel}</span><h3>{video.title}</h3><div><span><Eye size={13} /> {compactNumber(video.views)}</span><span><Heart size={13} /> {compactNumber(video.likes)}</span><span><MessageCircle size={13} /> {compactNumber(video.commentsCount)}</span></div></div>
                <div className="analysis-tags">{video.tags.length ? video.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>) : <span className="muted">해시태그 없음</span>}</div>
                <span className="analysis-date"><CalendarDays size={14} /> {new Date(video.analyzedAt).toLocaleDateString('ko-KR')}</span>
                <button className="row-open" aria-label="상세 보기"><ArrowRight size={18} /></button>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function SettingsPage() {
  return (
    <main className="page-content settings-page">
      <section className="page-heading"><div><div className="eyebrow">SUPPORT</div><h1>설정</h1><p>서비스 이용 중 도움이 필요하다면 편하게 문의해주세요.</p></div></section>
      <section className="contact-card">
        <span className="contact-icon"><MessageCircle size={26} /></span>
        <div><h2>무엇을 도와드릴까요?</h2><p>오류 신고, 이용 방법, 서비스에 대한 의견을 보내주세요.<br />확인 후 빠르게 답변드리겠습니다.</p></div>
        <a className="primary-button" href="https://kmong.com/gig/662833" target="_blank" rel="noreferrer"><MessageCircle size={18} /> 문의하기</a>
      </section>
    </main>
  );
}

function DetailDrawer({ video, onClose, onGoAnalysis }) {
  if (!video) return null;
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="detail-drawer" aria-label="영상 분석 상세">
        <div className="drawer-head"><div><span><Sparkles size={15} /> ANALYSIS COMPLETE</span><h2>영상 분석 결과</h2></div><button className="icon-btn" onClick={onClose} aria-label="닫기"><X size={20} /></button></div>
        <div className="drawer-scroll">
          <div className="drawer-video"><div className="drawer-thumb"><img src={video.thumbnail} alt="" /><span><Play fill="currentColor" size={22} /></span></div><div><span className="channel-line">{video.channelThumbnail && <img className="channel-avatar" src={video.channelThumbnail} alt="" />}{video.channel}</span><h3>{video.title}</h3><a href={video.url} target="_blank" rel="noreferrer">YouTube에서 보기 <ExternalLink size={13} /></a></div></div>
          <div className="detail-stats">
            <div><LayoutGrid size={17} /><span>카테고리<strong>{categoryLabels[video.category] || video.category || '-'}</strong></span></div>
            <div><Eye size={17} /><span>누적 조회수<strong>{compactNumber(video.views)}</strong></span></div>
            <div><Clock3 size={17} /><span>영상 길이<strong>{video.duration}</strong></span></div>
            <div><CalendarDays size={17} /><span>등록일<strong>{video.published}</strong></span></div>
            <div><Heart size={17} /><span>좋아요<strong>{compactNumber(video.likes)}</strong></span></div>
            <div><MessageCircle size={17} /><span>댓글<strong>{compactNumber(video.commentsCount)}</strong></span></div>
          </div>
          <section className="drawer-section"><div className="section-label"><Hash size={16} /><h4>해시태그</h4><span>{video.tags.length}개 발견</span></div>{video.tags.length ? <div className="hashtag-list">{video.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : <div className="no-data">해시태그 없음</div>}</section>
          <section className="drawer-section"><div className="section-label"><MessageCircle size={16} /><h4>좋아요가 많은 댓글 TOP 3</h4></div><div className="comment-list">{video.comments.map((comment, index) => <article key={comment.author}><span>{index + 1}</span><div><strong>{comment.author}</strong><p>{comment.text}</p><small><Heart size={11} fill="currentColor" /> {formatNumber(comment.likes)}</small></div></article>)}</div></section>
          <section className="drawer-section"><div className="section-label"><Clapperboard size={16} /><h4>스크립트</h4>{video.script && <button onClick={() => navigator.clipboard?.writeText(video.script)}>복사</button>}</div>{video.script ? <p className="script-text">{video.script}</p> : <div className="no-data">스크립트 없음</div>}</section>
          <div className="source-note"><Database size={15} /><span>영상 정보는 분석 시점 기준이며 일부 데이터는 YouTube 공개 설정에 따라 제공되지 않을 수 있습니다.</span></div>
        </div>
        <div className="drawer-action"><button onClick={onGoAnalysis}>분석 결과에서 보기 <ArrowRight size={16} /></button></div>
      </aside>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('main');
  const [activeCategory, setActiveCategory] = useState('all');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [analyzing, setAnalyzing] = useState(null);
  const [toast, setToast] = useState('');
  const [exportState, setExportState] = useState('idle');
  const [resetState, setResetState] = useState('idle');
  const [videoItems, setVideoItems] = useState(isSupabaseConfigured ? [] : sampleVideos);
  const [dashboardSummary, setDashboardSummary] = useState({});
  const [dataStatus, setDataStatus] = useState(isSupabaseConfigured ? 'loading' : 'demo');
  const [dataError, setDataError] = useState('');
  const [analyses, setAnalyses] = useState(() => {
    if (isSupabaseConfigured) return [];
    try { return JSON.parse(localStorage.getItem('ykm-analyses')) || []; } catch { return []; }
  });
  const [deviceId] = useState(getDeviceId);
  const [accessCode, setAccessCode] = useState(() => {
    try { return localStorage.getItem('ykm-access-code') || ''; } catch { return ''; }
  });
  // null = 확인 중, true = 통과, false = 게이트 표시. 데모(Supabase 미설정)에서는 게이트를 건너뛴다.
  const [verified, setVerified] = useState(isSupabaseConfigured ? null : true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [nickname, setNickname] = useState('');
  const authRef = useRef({ code: accessCode, deviceId });
  const shortsCheckedRef = useRef(new Set());

  useEffect(() => {
    if (!isSupabaseConfigured) {
      localStorage.setItem('ykm-analyses', JSON.stringify(analyses));
    }
  }, [analyses]);
  useEffect(() => { authRef.current = { code: accessCode, deviceId }; }, [accessCode, deviceId]);

  // 최초 로드 시 저장된 코드로 무음 재검증한다. 유효하면 통과, 아니면 게이트를 표시한다.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    if (!accessCode) { setVerified(false); return undefined; }
    let active = true;
    verifyAccessCode(accessCode, deviceId)
      .then((result) => {
        if (!active) return;
        if (result.ok) { setIsAdmin(!!result.isAdmin); setNickname(result.label || ''); setVerified(true); return; }
        setVerified(false);
        setAccessCode('');
        try { localStorage.removeItem('ykm-access-code'); } catch { /* noop */ }
      })
      .catch(() => { if (active) setVerified(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2800); return () => clearTimeout(timer); }, [toast]);

  // 자막 도우미 확장이 추출한 자막을 받아 저장하고 화면에 반영한다.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const handleExtensionMessage = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.type !== 'YKM_TRANSCRIPT_RESULT' || typeof data.videoId !== 'string' || !data.transcript) return;
      saveYoutubeTranscript(data.videoId, data.transcript, authRef.current)
        .then((result) => {
          setAnalyses((current) => current.map((item) => (item.id === result.id ? result : item)));
          setDetail((current) => (current && current.id === result.id ? result : current));
        })
        .catch(() => {});
    };
    window.addEventListener('message', handleExtensionMessage);
    return () => window.removeEventListener('message', handleExtensionMessage);
  }, []);

  // 확장에 영상 id 목록의 실제 쇼츠 여부 판별을 요청한다(이미 확인한 id는 중복 요청하지 않음).
  const requestShortsCheck = useCallback((videoIds) => {
    if (!isSupabaseConfigured) return;
    const pending = (videoIds || []).filter((id) => id && !shortsCheckedRef.current.has(id));
    if (!pending.length) return;
    pending.forEach((id) => shortsCheckedRef.current.add(id));
    window.postMessage({ type: 'YKM_CHECK_SHORTS_REQUEST', videoIds: pending }, window.location.origin);
  }, []);

  // 확장이 /shorts URL로 판별한 실제 쇼츠 여부를 받아 목록의 isShort를 보정한다.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const handleShortsResult = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.type !== 'YKM_CHECK_SHORTS_RESULT' || !data.results) return;
      setVideoItems((current) => current.map((video) => (
        typeof data.results[video.id] === 'boolean' ? { ...video, isShort: data.results[video.id] } : video
      )));
    };
    window.addEventListener('message', handleShortsResult);
    return () => window.removeEventListener('message', handleShortsResult);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || verified !== true) return undefined;
    let active = true;
    fetchYoutubeKeywordMasterData()
      .then((dashboard) => {
        if (!active) return;
        setVideoItems(dashboard.videos);
        setDashboardSummary(dashboard.summary);
        setDataStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setDataStatus('error');
        setDataError('데이터베이스 테이블과 Edge Function 배포 상태를 확인해주세요.');
      });
    fetchYoutubeKeywordMasterAnalyses({ code: accessCode, deviceId })
      .then((savedAnalyses) => {
        if (!active) return;
        setAnalyses(savedAnalyses);
      })
      .catch((error) => {
        console.error('Analysis list failed:', error);
        if (!active) return;
        setAnalyses([]);
      });
    return () => { active = false; };
  }, [verified, accessCode, deviceId]);

  const analyze = async (video) => {
    // 이미 분석한 영상은 재호출 없이 저장된 결과를 즉시 연다.
    // 스크립트가 비어 있으면 화면 전환 없이 백그라운드로만 자막 재시도(24시간 캐시 히트 시 쿼터 미사용).
    const existing = analyses.find((item) => item.id === video.id);
    if (existing) {
      setDetail(existing);
      if (!existing.script && isSupabaseConfigured) requestTranscriptViaExtension(video.id);
      return;
    }
    setAnalyzing(video);
    try {
      let result;
      if (isSupabaseConfigured) {
        result = await analyzeYoutubeVideo(video.id, authRef.current);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 850));
        result = enrichVideo(video);
      }
      setAnalyses((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setDetail(result);
      setToast('분석 결과에 추가했습니다.');
      if (!result.script && isSupabaseConfigured) requestTranscriptViaExtension(result.id);
    } catch {
      setToast('영상 분석에 실패했습니다. Edge Function 설정을 확인해주세요.');
    } finally {
      setAnalyzing(null);
    }
  };

  const exportExcel = async () => {
    if (!analyses.length) return;
    setExportState('loading');
    const rows = analyses.map((video) => [
      video.channel, video.title, video.url, video.duration, video.published, video.views, video.likes, video.commentsCount,
      video.tags.length ? video.tags.join(', ') : '해시태그 없음', video.script || '스크립트 없음',
      video.comments[0]?.text || '', video.comments[1]?.text || '', video.comments[2]?.text || '',
    ]);
    const buffer = await createXlsx(rows);
    const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `YouTube_Keyword_Master_분석결과_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(blobUrl); }, 1000);
    setExportState('done');
    setTimeout(() => setExportState('idle'), 2200);
  };

  const resetAnalyses = async () => {
    if (!analyses.length || !window.confirm('저장된 분석 결과를 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    setResetState('loading');
    try {
      if (isSupabaseConfigured) await clearYoutubeKeywordMasterAnalyses(authRef.current);
      setAnalyses([]);
      setDetail(null);
      setToast('분석 결과를 모두 초기화했습니다.');
    } catch {
      setToast('분석 결과 초기화에 실패했습니다.');
    } finally {
      setResetState('idle');
    }
  };

  const logout = () => {
    try { localStorage.removeItem('ykm-access-code'); } catch { /* noop */ }
    setAccessCode('');
    setIsAdmin(false);
    setNickname('');
    setVerified(false);
    setActiveTab('main');
    setMobileOpen(false);
    setDetail(null);
    setAnalyses([]);
  };

  // 앱 전체 잠금: 인증되지 않으면 대시보드 대신 접근 코드 게이트만 렌더한다.
  if (isSupabaseConfigured && verified !== true) {
    return verified === null
      ? (
        <div className="access-gate">
          <div className="access-card checking"><RefreshCw className="spin" size={22} /><p>접속 확인 중...</p></div>
        </div>
      )
      : (
        <AccessGate
          deviceId={deviceId}
          onVerified={(code, admin, label) => {
            try { localStorage.setItem('ykm-access-code', code); } catch { /* noop */ }
            setAccessCode(code);
            setIsAdmin(!!admin);
            setNickname(label || '');
            setVerified(true);
          }}
        />
      );
  }

  return (
    <div className="app-shell">
      <Sidebar activeCategory={activeCategory} setActiveCategory={(id) => { setActiveCategory(id); setActiveTab('main'); }} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} videoItems={videoItems} />
      <div className="main-shell">
        <Header activeTab={activeTab} setActiveTab={setActiveTab} analysisCount={analyses.length} openMobile={() => setMobileOpen(true)} isAdmin={isAdmin} nickname={nickname} onLogout={logout} />
        {activeTab === 'main' && <MainDashboard activeCategory={activeCategory} onAnalyze={analyze} videoItems={videoItems} summary={dashboardSummary} dataStatus={dataStatus} dataError={dataError} onCheckShorts={requestShortsCheck} />}
        {activeTab === 'analysis' && <AnalysisPage analyses={analyses} onOpen={setDetail} onExport={exportExcel} exportState={exportState} onReset={resetAnalyses} resetState={resetState} />}
        {activeTab === 'settings' && <SettingsPage />}
        {activeTab === 'admin' && isAdmin && <AdminPage auth={{ code: accessCode, deviceId }} />}
      </div>
      {analyzing && <div className="analyzing-overlay"><div><span className="scan-logo"><Play fill="currentColor" size={20} /></span><div className="scan-line" /><strong>영상을 분석하고 있어요</strong><p>댓글, 해시태그, 스크립트를 수집 중입니다.</p></div></div>}
      <DetailDrawer video={detail} onClose={() => setDetail(null)} onGoAnalysis={() => { setDetail(null); setActiveTab('analysis'); }} />
      <div className={`toast ${toast ? 'show' : ''}`}><Check size={16} />{toast}</div>
    </div>
  );
}

export default App;
