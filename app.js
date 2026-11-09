/* OPC Vault — standalone PWA app (generated from client.js core by build.mjs). */
(function () {
  'use strict';

    /* ============================ constants ============================ */
    const PBKDF2_ITERATIONS = 600000;
    const SALT_BYTES = 16;
    const IV_BYTES = 12;
    const DB_NAME = 'opc-vault-db';
    const DB_STORE = 'kv';
    const IDLE_LOCK_MS = 5 * 60 * 1000;
    const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
    const OPC_ECOSYSTEM = { brand: '沐言 AI', nav: 'https://boyue.ai', businessOs: 'https://boyue.ai' };
    // 税务档案字段（中国报税场景）
    const TAX_FIELDS = [
      { key: 'province', label: '省份/地区', placeholder: '如 北京' },
      { key: 'taxpayer', label: '纳税人身份', placeholder: '小规模 / 一般纳税人' },
      { key: 'method', label: '征收方式', placeholder: '查账 / 核定' },
      { key: 'hasStaff', label: '是否代扣个税', placeholder: '有员工 / 仅法人' },
      { key: 'zero', label: '是否零申报', placeholder: '是 / 否' },
      { key: 'industry', label: '行业', placeholder: '如 信息技术服务' },
    ];

    /* ============================ byte helpers ============================ */
    function randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
    function bufToB64(buf) {
      const bytes = new Uint8Array(buf); let bin = ''; const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      return btoa(bin);
    }
    function b64ToBuf(b64) { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes; }
    const te = new TextEncoder(); const td = new TextDecoder();

    /* ============================ crypto ============================ */
    async function deriveKEK(masterPw, saltBytes) {
      const baseKey = await crypto.subtle.importKey('raw', te.encode(masterPw), 'PBKDF2', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    }
    async function deriveKEKFromPrf(prfBytes, saltBytes) {
      const baseKey = await crypto.subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: te.encode('opc-vault-passkey-dek') },
        baseKey, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    }
    async function generateDEK() { return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
    async function wrapDEK(dek, kek) {
      const iv = randomBytes(IV_BYTES);
      const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
      return { iv: bufToB64(iv), wrapped: bufToB64(wrapped) };
    }
    async function unwrapDEK(ivB64, wrappedB64, kek) {
      return crypto.subtle.unwrapKey('raw', b64ToBuf(wrappedB64), kek, { name: 'AES-GCM', iv: b64ToBuf(ivB64) },
        { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    }
    async function encryptObject(dek, obj) {
      const iv = randomBytes(IV_BYTES);
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, te.encode(JSON.stringify(obj)));
      return { iv: bufToB64(iv), ct: bufToB64(ct), v: 1 };
    }
    async function decryptObject(dek, payload) {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(payload.iv) }, dek, b64ToBuf(payload.ct));
      return JSON.parse(td.decode(pt));
    }

    /* ============================ IndexedDB ============================ */
    let _dbp = null;
    function idb() {
      if (_dbp) return _dbp;
      _dbp = new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return _dbp;
    }
    async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const rq = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
    async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(DB_STORE, 'readwrite'); tx.objectStore(DB_STORE).put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }

    /* ============================ schema — 公司主体 ============================ */
    const SUBJECT_GROUPS = [
      { key: 'biz', label: '工商基础', icon: '🏢', fields: [
        { key: 'companyName', label: '公司名称', type: 'text' },
        { key: 'creditCode', label: '统一社会信用代码', type: 'text', mono: true },
        { key: 'legalRepName', label: '法定代表人', type: 'text' },
        { key: 'registeredCapital', label: '注册资本', type: 'text' },
        { key: 'establishDate', label: '成立日期', type: 'date' },
        { key: 'businessTerm', label: '营业期限', type: 'text' },
        { key: 'companyType', label: '公司类型', type: 'text' },
        { key: 'registeredAddress', label: '注册地址 / 公司地址', type: 'textarea' },
        { key: 'businessScope', label: '经营范围', type: 'textarea' },
        { key: 'registrationAuthority', label: '登记机关', type: 'text' },
        { key: 'approvalDate', label: '核准日期', type: 'date' },
        { key: 'taxpayerId', label: '纳税人识别号', type: 'text', mono: true },
        { key: 'orgCode', label: '组织机构代码', type: 'text', mono: true },
      ] },
      { key: 'legal', label: '法人 / 联系人', icon: '👤', fields: [
        { key: 'legalRepPhone', label: '法人手机号', type: 'text', mono: true },
        { key: 'legalRepIdNo', label: '法人身份证号', type: 'secret', mono: true },
        { key: 'legalRepEmail', label: '法人邮箱', type: 'text' },
        { key: 'financeOfficerName', label: '财务负责人 · 姓名', type: 'text' },
        { key: 'financeOfficerPhone', label: '财务负责人 · 手机', type: 'text', mono: true },
        { key: 'financeOfficerIdNo', label: '财务负责人 · 身份证号', type: 'secret' },
        { key: 'taxOfficerName', label: '办税员 · 姓名', type: 'text' },
        { key: 'taxOfficerPhone', label: '办税员 · 手机', type: 'text', mono: true },
        { key: 'companyPhone', label: '公司联系电话', type: 'text' },
        { key: 'companyEmail', label: '企业邮箱', type: 'text' },
        { key: 'registeredPhone', label: '注册手机号', type: 'text', mono: true },
      ] },
      { key: 'certs', label: '证照与印章', icon: '📜', fields: [
        { key: 'businessLicenseImage', label: '营业执照', type: 'image', ocr: 'license' },
        { key: 'eBusinessLicenseImage', label: '电子营业执照', type: 'image' },
        { key: 'companySealImage', label: '公司电子章', type: 'image' },
        { key: 'legalRepIdFront', label: '法人身份证 · 正面', type: 'image', ocr: 'idcard' },
        { key: 'legalRepIdBack', label: '法人身份证 · 反面', type: 'image' },
        { key: 'officialSealImage', label: '公章', type: 'image' },
        { key: 'financeSealImage', label: '财务章', type: 'image' },
        { key: 'legalRepSealImage', label: '法人章', type: 'image' },
        { key: 'contractSealImage', label: '合同章', type: 'image' },
        { key: 'invoiceSealImage', label: '发票章', type: 'image' },
        { key: 'bankPermitImage', label: '银行开户许可证', type: 'image' },
      ] },
    ];

    /* ============================ schema — 账套 ============================ */
    const ACCOUNT_GROUPS = [
      { key: 'setinfo', label: '账套信息', icon: '📒', fields: [
        { key: 'name', label: '账套名称', type: 'text' },
        { key: 'accountingYear', label: '会计年度', type: 'text', placeholder: '如 2026' },
        { key: 'accountingStandard', label: '会计准则', type: 'text', placeholder: '小企业会计准则 / 企业会计准则' },
        { key: 'taxpayerType', label: '纳税人身份', type: 'text', placeholder: '小规模纳税人 / 一般纳税人' },
        { key: 'industry', label: '行业类型', type: 'text', placeholder: '如 商贸 / 服务 / 制造' },
        { key: 'currency', label: '记账币种', type: 'text', placeholder: '人民币 CNY' },
        { key: 'status', label: '账套状态', type: 'text', placeholder: '在用 / 停用 / 注销' },
        { key: 'region', label: '所在地区（用于电子税务局）', type: 'text', placeholder: '如 上海 / 广东 深圳' },
        { key: 'startDate', label: '启用日期', type: 'date' },
        { key: 'agency', label: '代账机构 / 服务商', type: 'text' },
        { key: 'bookkeeper', label: '记账会计', type: 'text' },
        { key: 'reviewer', label: '审核会计', type: 'text' },
        { key: 'supervisor', label: '主管 / 负责人', type: 'text' },
      ] },
      { key: 'bank', label: '对公账户', icon: '🏦', fields: [
        { key: 'basicBankName', label: '基本户 · 开户行', type: 'text' },
        { key: 'basicAccountName', label: '基本户 · 账户名称', type: 'text' },
        { key: 'basicAccountNo', label: '基本户 · 账号', type: 'text', mono: true },
        { key: 'basicAccountPassword', label: '基本户 · 密码 / 取款密码', type: 'secret' },
        { key: 'basicBankCode', label: '基本户 · 开户行行号', type: 'text', mono: true },
        { key: 'generalBankName', label: '一般户 · 开户行', type: 'text' },
        { key: 'generalAccountName', label: '一般户 · 账户名称', type: 'text' },
        { key: 'generalAccountNo', label: '一般户 · 账号', type: 'text', mono: true },
        { key: 'generalAccountPassword', label: '一般户 · 密码', type: 'secret' },
        { key: 'generalBankCode', label: '一般户 · 开户行行号', type: 'text', mono: true },
        { key: 'accountOpeningDate', label: '基本户 · 开户日期', type: 'date' },
      ] },
      { key: 'tax', label: '税务', icon: '🧾', fields: [
        { key: 'taxBureauUrl', label: '电子税务局网址', type: 'url' },
        { key: 'etaxAccount', label: '电子税务局 · 登录账号', type: 'text' },
        { key: 'etaxPassword', label: '电子税务局 · 密码', type: 'secret' },
        { key: 'iitPassword', label: '个人所得税 · 密码', type: 'secret' },
        { key: 'naturalPersonTaxAccount', label: '自然人电子税务局 · 账号', type: 'text' },
        { key: 'naturalPersonTaxPassword', label: '自然人电子税务局 · 密码', type: 'secret' },
        { key: 'invoiceSoftwareAccount', label: '开票软件 / 税控 · 账号', type: 'text' },
        { key: 'invoiceSoftwarePassword', label: '开票软件 / 税控 · 密码', type: 'secret' },
        { key: 'socialSecurityAccount', label: '社保 · 账号', type: 'text' },
        { key: 'socialSecurityPassword', label: '社保 · 密码', type: 'secret' },
        { key: 'housingFundAccount', label: '公积金 · 账号', type: 'text' },
        { key: 'housingFundPassword', label: '公积金 · 密码', type: 'secret' },
        { key: 'invoiceTitle', label: '发票抬头', type: 'text' },
      ] },
      { key: 'platforms', label: '平台与系统', icon: '🌐', fields: [
        { key: 'eBusinessLicenseMiniProgram', label: '电子营业执照小程序', type: 'text' },
        { key: 'gsxtAccount', label: '国家企业信用信息公示系统 · 账号', type: 'text' },
        { key: 'gsxtPassword', label: '国家企业信用信息公示系统 · 密码', type: 'secret' },
        { key: 'eSignaturePlatform', label: '电子签章平台', type: 'text' },
        { key: 'corporateOnlineBank', label: '企业网银（U 盾 / 账号）', type: 'text' },
        { key: 'wecomAdmin', label: '企业微信 / 钉钉管理员', type: 'text' },
        { key: 'domainIcp', label: '域名与备案信息', type: 'textarea' },
      ] },
      { key: 'ip', label: '资质与知识产权', icon: '', fields: [
        { key: 'trademarkImage', label: '商标注册证', type: 'image' },
        { key: 'patentImage', label: '专利证书', type: 'image' },
        { key: 'softwareCopyrightImage', label: '软件著作权证书', type: 'image' },
        { key: 'licensePermits', label: '经营许可证 / 特殊资质（食品、ICP 等）', type: 'textarea' },
      ] },
      { key: 'compliance', label: '经营与合规', icon: '', fields: [
        { key: 'annualReportDone', label: '工商年报（是否已报）', type: 'text' },
        { key: 'taxSettlementDone', label: '汇算清缴（是否已办）', type: 'text' },
        { key: 'socialSecurityBase', label: '社保 / 公积金缴纳基数', type: 'text' },
        { key: 'bankLoanInfo', label: '银行贷款 / 授信信息', type: 'textarea' },
        { key: 'shareholders', label: '股东与股权结构', type: 'textarea' },
        { key: 'keyContracts', label: '主要合同 / 合作方', type: 'textarea' },
      ] },
      { key: 'other', label: '其他', icon: '🗂️', fields: [
        { key: 'annualReportDate', label: '工商年报提醒日', type: 'date' },
        { key: 'taxSettlementDeadline', label: '汇算清缴截止日', type: 'date' },
        { key: 'notes', label: '备注', type: 'textarea' },
      ] },
    ];

    const REGIONS = [
      { name: '全国统一（新电子税务局）', url: 'https://etax.chinatax.gov.cn' },
      { name: '北京', url: 'https://beijing.chinatax.gov.cn' },
      { name: '上海', url: 'https://shanghai.chinatax.gov.cn' },
      { name: '广东', url: 'https://guangdong.chinatax.gov.cn' },
      { name: '深圳', url: 'https://shenzhen.chinatax.gov.cn' },
      { name: '江苏', url: 'https://jiangsu.chinatax.gov.cn' },
      { name: '浙江', url: 'https://zhejiang.chinatax.gov.cn' },
      { name: '山东', url: 'https://shandong.chinatax.gov.cn' },
      { name: '四川', url: 'https://sichuan.chinatax.gov.cn' },
      { name: '湖北', url: 'https://hubei.chinatax.gov.cn' },
      { name: '湖南', url: 'https://hunan.chinatax.gov.cn' },
      { name: '河南', url: 'https://henan.chinatax.gov.cn' },
      { name: '福建', url: 'https://fujian.chinatax.gov.cn' },
      { name: '安徽', url: 'https://anhui.chinatax.gov.cn' },
      { name: '天津', url: 'https://tianjin.chinatax.gov.cn' },
      { name: '重庆', url: 'https://chongqing.chinatax.gov.cn' },
    ];

    function subjectKeys() { const s = new Set(); SUBJECT_GROUPS.forEach((g) => g.fields.forEach((f) => s.add(f.key))); return s; }
    function accountKeys() { const s = new Set(); ACCOUNT_GROUPS.forEach((g) => g.fields.forEach((f) => s.add(f.key))); return s; }

    /* ============================ icons ============================ */
    const ICON = {
      copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
      eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
      eyeOff: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.1A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.3 3.9"/><path d="M6.3 6.9A17 17 0 0 0 2 12s3.5 7 10 7a10.5 10.5 0 0 0 4.1-.8"/></svg>',
      lock: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
      upload: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/></svg>',
      trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/></svg>',
      scan: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M20 8V5a1 1 0 0 0-1-1h-3"/><path d="M4 16v3a1 1 0 0 0 1 1h3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M4 12h16"/></svg>',
      plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
      search: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>',
      external: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></svg>',
      key: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="4"/><path d="M11 11l9 9"/><path d="M17 17l2-2"/><path d="M14 14l2-2"/></svg>',
      download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>',
      close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
    };
    const SHIELD_BIG = '<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true"><defs><linearGradient id="opcv-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f8ef0"/><stop offset="1" stop-color="#1b5fb8"/></linearGradient></defs><path d="M32 5 L55 13 V30 C55 45 44 55 32 60 C20 55 9 45 9 30 V13 Z" fill="url(#opcv-g)" stroke="#0f3d78" stroke-width="2" stroke-linejoin="round"/><circle cx="32" cy="27" r="6.5" fill="#fff"/><rect x="29.6" y="31" width="4.8" height="13" rx="2.4" fill="#fff"/></svg>';

    /* ============================ DOM helpers ============================ */
    function E(tag, opts, ...kids) {
      const el = document.createElement(tag);
      opts = opts || {};
      if (opts.class) el.className = opts.class;
      if (opts.style) el.setAttribute('style', opts.style);
      if (opts.text != null) el.textContent = opts.text;
      if (opts.html != null) el.innerHTML = opts.html;
      if (opts.attrs) for (const k in opts.attrs) el.setAttribute(k, opts.attrs[k]);
      if (opts.props) for (const k in opts.props) { try { el[k] = opts.props[k]; } catch (e) {} }
      if (opts.on) for (const k in opts.on) el.addEventListener(k, opts.on[k]);
      for (const kid of kids) { if (kid == null) continue; el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); }
      return el;
    }

    /* ============================ OCR (lazy) ============================ */
    let _tessP = null;
    function loadTesseract() {
      if (window.Tesseract) return Promise.resolve(window.Tesseract);
      if (_tessP) return _tessP;
      _tessP = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = TESSERACT_CDN;
        s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error('OCR 引擎未初始化')));
        s.onerror = () => rej(new Error('OCR 引擎加载失败（可能离线或被页面 CSP 拦截）'));
        document.head.appendChild(s);
      });
      return _tessP;
    }
    async function ocrImage(dataUrl, onProgress) {
      const T = await loadTesseract();
      const out = await T.recognize(dataUrl, 'chi_sim+eng', { logger: (m) => { if (onProgress && m && m.status) onProgress(m); } });
      return (out && out.data && out.data.text) || '';
    }
    function cjkSqueeze(s) {
      return String(s || '').replace(/([\u4e00-\u9fa5])[ \t]+(?=[\u4e00-\u9fa5])/g, '$1');
    }
    function parseOCR(text) {
      const res = {};
      if (!text) return res;
      text = cjkSqueeze(text);
      const compact = text.replace(/[^0-9A-Za-z]/g, '');
      const cc = compact.match(/[0-9A-Z]{18}/);
      if (cc) res.creditCode = cc[0];
      const nameM = text.match(/(?:名\s*称|公司名称)[:：]?\s*([^\n]{2,50})/);
      if (nameM) res.companyName = nameM[1].replace(/[。\.;；].*$/, '').trim();
      const repM = text.match(/(?:法定代表人|法人代表|负责人|经营者)[:：]?\s*([^\n]{2,20})/);
      if (repM) res.legalRepName = repM[1].replace(/[。\.;；].*$/, '').trim();
      const capM = text.match(/注册资本[:：]?\s*([^\n]{1,40})/);
      if (capM) res.registeredCapital = capM[1].trim();
      const dateM = text.match(/(?:成立日期|注册日期|成立时间)[:：]?\s*(\d{4})\s*[年\-\.\/]\s*(\d{1,2})\s*[月\-\.\/]\s*(\d{1,2})/);
      if (dateM) res.establishDate = dateM[1] + '-' + String(dateM[2]).padStart(2, '0') + '-' + String(dateM[3]).padStart(2, '0');
      return res;
    }
    function extractLicenseFields(text) {
      const res = Object.assign({}, parseOCR(text));
      if (!text) return res;
      const t = cjkSqueeze(text);
      const typeM = t.match(/(?:公司类型|企业类型|类型)\s*[:：]?\s*([^\n]{2,24})/);
      if (typeM) res.companyType = cleanVal(typeM[1]);
      const addrM = t.match(/(?:住所|注册地址|公司地址|营业场所|经营场所|地址)\s*[:：]?\s*([^\n]{2,80})/);
      if (addrM) res.registeredAddress = cleanVal(addrM[1]);
      const scopeM = t.match(/经营范围\s*[:：]?\s*([\s\S]{2,300}?)(?:\n|登记机关|核准日期|$)/);
      if (scopeM) res.businessScope = cleanVal(scopeM[1].replace(/\s+/g, ' ')).slice(0, 300);
      const authM = t.match(/登记机关\s*[:：]?\s*([^\n]{2,40})/);
      if (authM) res.registrationAuthority = cleanVal(authM[1]);
      const phoneM = t.match(/1[3-9]\d{9}/);
      if (phoneM) res.legalRepPhone = phoneM[0];
      ['companyName', 'legalRepName', 'registeredCapital', 'companyType', 'registeredAddress', 'businessScope', 'registrationAuthority', 'establishDate'].forEach((k) => { if (res[k] != null) res[k] = cleanVal(res[k]); });
      if (!res.establishDate) { const d = t.match(/成立日期\s*[:：]?\s*(\d{4})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})/); if (d) res.establishDate = d[1] + '-' + String(d[2]).padStart(2, '0') + '-' + String(d[3]).padStart(2, '0'); }
      return res;
    }

    /* ============================ WebAuthn eligibility ============================ */
    function isElectron() { try { return /Electron/i.test(navigator.userAgent || ''); } catch (e) { return false; } }
    function passkeyEnv() {
      const r = { ok: false, reason: '', msg: '' };
      try {
        if (!window.PublicKeyCredential || !navigator.credentials || !crypto || !crypto.subtle) { r.reason = 'NO_WEBAUTHN'; r.msg = '当前浏览器/内嵌环境不支持 WebAuthn（Passkey），请用最新版 Chrome / Edge 打开。'; return r; }
        if (!window.isSecureContext) { r.reason = 'INSECURE'; r.msg = '当前不是安全上下文（需 HTTPS 或 http://localhost）。'; return r; }
        const isHttps = location.protocol === 'https:';
        const isLocalhost = location.hostname === 'localhost';
        if (!isHttps && !isLocalhost) { r.reason = 'ORIGIN_IP'; r.msg = '当前地址 ' + location.origin + ' 既非 HTTPS 也非 http://localhost；WebAuthn 不允许在 IP 源启用 Passkey。请把地址栏的 127.0.0.1 改成 localhost（端口与 token 不变）再打开。'; return r; }
        r.ok = true; return r;
      } catch (e) { r.reason = 'ERROR'; r.msg = 'Passkey 环境检测失败：' + (e && e.message ? e.message : e); return r; }
    }
    function passkeyEligible() { return passkeyEnv().ok; }
    function passkeyHint() { const e = passkeyEnv(); return e.ok ? '' : e.msg + (isElectron() ? '（检测到 Harness 内嵌窗口，建议改用 Chrome/Edge 打开同一地址）' : ''); }

    /* ============================ smart bulk-import parser ============================ */
    function regionUrl(name) {
      if (!name) return REGIONS[0].url;
      const hit = REGIONS.find((r) => r.name !== '全国统一（新电子税务局）' && String(name).indexOf(r.name) >= 0);
      return hit ? hit.url : REGIONS[0].url;
    }
    function cleanVal(v) { return String(v == null ? '' : v).replace(/^[\s:：=]+|[\s,，;；。]+$/g, '').trim(); }
    function normalizeDate(v) {
      const m = String(v || '').match(/(\d{4})\s*[年\-\.\/]\s*(\d{1,2})\s*[月\-\.\/]\s*(\d{1,2})/);
      if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
      return cleanVal(v);
    }
    function labelToKey(label, bankCtx) {
      const s = String(label || '').replace(/[\s:：()（）\[\]【】·•\-_\/]/g, '');
      if (!s) return null;
      const gen = bankCtx === 'general';
      // tax / social / housing / invoice credentials FIRST, so the generic 账号/密码 bank rules don't swallow them
      if (/(电子税务局|社保|个人所得税|个税|自然人|公积金|开票|税控|税务)/.test(s)) {
        if (/电子税务局/.test(s) && /(网址|地址|url)/i.test(s)) return 'taxBureauUrl';
        if (/电子税务局/.test(s) && /(密码|口令)/.test(s)) return 'etaxPassword';
        if (/电子税务局/.test(s) && /(账号|账户|用户名|登录)/.test(s)) return 'etaxAccount';
        if (/(个人所得税|个税)/.test(s) && /(密码|口令)/.test(s)) return 'iitPassword';
        if (/自然人.*电子税务局/.test(s) && /(密码|口令)/.test(s)) return 'naturalPersonTaxPassword';
        if (/自然人.*电子税务局/.test(s) && /(账号|账户)/.test(s)) return 'naturalPersonTaxAccount';
        if (/社保/.test(s) && /(密码|口令)/.test(s)) return 'socialSecurityPassword';
        if (/社保/.test(s) && /(账号|账户)/.test(s)) return 'socialSecurityAccount';
        if (/公积金/.test(s) && /(密码|口令)/.test(s)) return 'housingFundPassword';
        if (/公积金/.test(s) && /(账号|账户)/.test(s)) return 'housingFundAccount';
        if (/(开票|税控)/.test(s) && /(密码|口令)/.test(s)) return 'invoiceSoftwarePassword';
        if (/(开票|税控)/.test(s) && /(账号|账户)/.test(s)) return 'invoiceSoftwareAccount';
        if (/(密码|口令)/.test(s)) return 'etaxPassword';
        if (/(账号|账户)/.test(s)) return 'etaxAccount';
      }
      // bank accounts
      if (/开户行|开户银行|银行名称|支行/.test(s)) return gen ? 'generalBankName' : 'basicBankName';
      if (/联行号|行号/.test(s)) return gen ? 'generalBankCode' : 'basicBankCode';
      if (/账户名称|户名|账户名|开户名/.test(s)) return gen ? 'generalAccountName' : 'basicAccountName';
      if (/取款密码|银行密码|账户密码|银行卡密码|密码$/.test(s)) return gen ? 'generalAccountPassword' : 'basicAccountPassword';
      if (/账号|卡号|银行账号|对公账号/.test(s)) return gen ? 'generalAccountNo' : 'basicAccountNo';
      if (/统一社会信用代码|信用代码|统一代码/.test(s)) return 'creditCode';
      if (/纳税人识别号|税号/.test(s)) return 'taxpayerId';
      if (/组织机构代码/.test(s)) return 'orgCode';
      if (/公司名称|企业名称|单位名称|客户名称|^名称$|^公司$|^全称$/.test(s)) return 'companyName';
      if (/法定代表人|法人代表|^法人$|负责人|经营者/.test(s)) return 'legalRepName';
      if (/注册资本|注册资金/.test(s)) return 'registeredCapital';
      if (/成立日期|成立时间|注册日期/.test(s)) return 'establishDate';
      if (/营业期限|经营期限/.test(s)) return 'businessTerm';
      if (/公司类型|企业类型|^类型$/.test(s)) return 'companyType';
      if (/注册地址|公司地址|经营地址|^地址$|住所/.test(s)) return 'registeredAddress';
      if (/经营范围/.test(s)) return 'businessScope';
      if (/登记机关|发证机关/.test(s)) return 'registrationAuthority';
      if (/核准日期/.test(s)) return 'approvalDate';
      if (/(法人|法定代表人).*(手机|电话)|法人手机|法人电话/.test(s)) return 'legalRepPhone';
      if (/(法人|法定代表人).*身份证|身份证号码|^身份证号$|^身份证$/.test(s)) return 'legalRepIdNo';
      if (/(法人|法定代表人).*邮箱/.test(s)) return 'legalRepEmail';
      if (/财务负责人.*(手机|电话)/.test(s)) return 'financeOfficerPhone';
      if (/财务负责人/.test(s) && /(姓名|名字)/.test(s)) return 'financeOfficerName';
      if (/财务负责人.*身份证/.test(s)) return 'financeOfficerIdNo';
      if (/办税员.*(手机|电话)/.test(s)) return 'taxOfficerPhone';
      if (/办税员/.test(s) && /(姓名|名字)/.test(s)) return 'taxOfficerName';
      if (/企业邮箱|公司邮箱|^邮箱$|e-?mail/i.test(s)) return 'companyEmail';
      if (/公司电话|企业电话|联系电话|^电话$|^手机号$|注册手机/.test(s)) return 'companyPhone';
      if (/纳税人身份|纳税人类型|纳税人资格/.test(s)) return 'taxpayerType';
      if (/会计准则/.test(s)) return 'accountingStandard';
      if (/会计年度|账套年度|^年度$/.test(s)) return 'accountingYear';
      if (/行业/.test(s)) return 'industry';
      if (/币种|记账本位币/.test(s)) return 'currency';
      if (/所在地区|^地区$|^省份$|^省市$|所属地区/.test(s)) return 'region';
      if (/账套名称|账套名/.test(s)) return 'name';
      if (/代账机构|服务商|代理记账/.test(s)) return 'agency';
      if (/记账会计/.test(s)) return 'bookkeeper';
      if (/审核会计/.test(s)) return 'reviewer';
      if (/备注/.test(s)) return 'notes';
      return null;
    }
    function extractFields(block) {
      const subj = {}, acc = {}, sKeys = subjectKeys(), aKeys = accountKeys();
      let bankCtx = 'basic';
      const put = (k, v) => { v = cleanVal(v); if (!v) return; if (sKeys.has(k)) { if (subj[k] == null) subj[k] = v; } else if (aKeys.has(k)) { if (acc[k] == null) acc[k] = v; } };
      String(block || '').split('\n').forEach((raw) => {
        const line = raw.trim(); if (!line) return;
        if (/一般户|一般账户|一般存款账户/.test(line)) bankCtx = 'general';
        if (/基本户|基本账户|基本存款账户/.test(line)) bankCtx = 'basic';
        let label = null, value = null;
        let m = line.match(/^([^\t:：=]{1,18})[\t:：=]\s*(.+)$/);
        if (m) { label = m[1].trim(); value = m[2].trim(); }
        else { m = line.match(/^([^\s:：=]{1,14})\s{2,}(.+)$/); if (m) { label = m[1].trim(); value = m[2].trim(); } }
        if (label != null) { const k = labelToKey(label, bankCtx); if (k) { put(k, value); return; } }
        if (/(公司|厂|店|中心|工作室|合作社|集团|事务所)$/.test(line) && line.length <= 30 && !/[:：]/.test(line)) { if (subj.companyName == null) subj.companyName = cleanVal(line); }
      });
      const cc = String(block).replace(/[^0-9A-Za-z]/g, '').match(/[0-9A-Z]{18}/);
      if (cc && subj.creditCode == null) subj.creditCode = cc[0];
      if (subj.establishDate) subj.establishDate = normalizeDate(subj.establishDate);
      if (acc.region == null) { const hit = REGIONS.find((r) => r.name !== '全国统一（新电子税务局）' && String(block).indexOf(r.name) >= 0); if (hit) acc.region = hit.name; }
      return { subj, acc };
    }
    function tryTable(nonEmpty) {
      if (nonEmpty.length < 2) return null;
      const first = nonEmpty[0];
      let sep = null, cols = null;
      if (first.indexOf('\t') >= 0) { sep = '\t'; cols = first.split('\t'); }
      else if (first.indexOf(',') >= 0) { sep = ','; cols = first.split(','); }
      else if (first.indexOf('，') >= 0) { sep = '，'; cols = first.split('，'); }
      else if (/\s{2,}/.test(first)) { sep = /\s{2,}/; cols = first.split(sep); }
      if (!cols || cols.length < 3) return null;
      const keyMap = cols.map((c) => labelToKey(c.trim(), 'basic'));
      if (keyMap.filter(Boolean).length < 2) return null;
      const sKeys = subjectKeys(), aKeys = accountKeys(), recs = [];
      for (let i = 1; i < nonEmpty.length; i++) {
        const cells = sep instanceof RegExp ? nonEmpty[i].split(sep) : nonEmpty[i].split(sep);
        if (cells.length < 2) continue;
        const subj = {}, acc = {};
        keyMap.forEach((k, idx) => { if (k && cells[idx] != null) { const v = cleanVal(cells[idx]); if (v) { if (sKeys.has(k)) subj[k] = v; else if (aKeys.has(k)) acc[k] = v; } } });
        if (Object.keys(subj).length || Object.keys(acc).length) recs.push({ subj, acc });
      }
      return recs.length ? recs : null;
    }
    function splitFlat(obj) {
      const subj = {}, acc = {}, sKeys = subjectKeys(), aKeys = accountKeys();
      Object.keys(obj || {}).forEach((k) => {
        let v = obj[k];
        if (v && typeof v === 'object' && v.values) v = v.values;
        if (v == null || v === '') return;
        const key = (sKeys.has(k) || aKeys.has(k)) ? k : labelToKey(k, /一般户|一般账户/.test(k) ? 'general' : 'basic');
        if (!key) return;
        v = String(v);
        if (sKeys.has(key)) subj[key] = v; else if (aKeys.has(key)) acc[key] = v;
      });
      return { subj, acc };
    }
    function coerceRecords(obj) {
      const out = [];
      if (obj && Array.isArray(obj.subjects) && Array.isArray(obj.accountSets)) {
        obj.subjects.forEach((s, idx) => {
          const sv = (s && s.values) ? s.values : (s || {});
          const sid = (s && s.id) || ('auto' + idx);
          let chosen = obj.accountSets.filter((a) => (a.subjectIds || []).indexOf(sid) >= 0);
          if (!chosen.length) chosen = obj.accountSets.slice(idx, idx + 1);
          if (!chosen.length) out.push({ subj: sv, acc: {} });
          chosen.forEach((a) => out.push({ subj: sv, acc: (a && a.values) ? a.values : (a || {}) }));
        });
        return out;
      }
      const arr = Array.isArray(obj) ? obj : [obj];
      arr.forEach((r) => {
        if (!r || typeof r !== 'object') return;
        if (r.subject || r.subj || r.account || r.acc) {
          const sv = r.subject || r.subj || {}, av = r.account || r.acc || {};
          out.push({ subj: (sv.values || sv), acc: (av.values || av) });
        } else {
          out.push(splitFlat(r));
        }
      });
      return out;
    }
    function parseStructured(text) {
      const t = String(text || '').trim();
      if (!(t.startsWith('{') || t.startsWith('['))) return null;
      let obj; try { obj = JSON.parse(t); } catch (e) { return null; }
      try {
        const recs = coerceRecords(obj).filter((r) => r && (Object.keys(r.subj || {}).length || Object.keys(r.acc || {}).length));
        return recs.length ? recs : null;
      } catch (e) { return null; }
    }
    function parseFreeformByCodes(text) {
      const codeRe = /[0-9A-Z]{18}/g; const codes = []; let mm;
      while ((mm = codeRe.exec(text))) { const v = mm[0]; if ((v.match(/\d/g) || []).length >= 8) codes.push({ v, i: mm.index }); }
      if (!codes.length) return [];
      const nameRe = /([\u4e00-\u9fa5A-Za-z0-9（）()]{2,40}?(?:股份有限公司|有限责任公司|有限公司|公司|厂|店|中心|工作室|合作社|集团|事务所))/g;
      const namePos = []; let nn;
      while ((nn = nameRe.exec(text))) { namePos.push({ name: nn[1], i: nn.index, end: nn.index + nn[1].length }); }
      const recs = [];
      for (let k = 0; k < codes.length; k++) {
        const c = codes[k]; const codeEnd = c.i + c.v.length;
        let chosen = null; for (const np of namePos) { if (np.end <= c.i && c.i - np.end <= 40) chosen = np; }
        const subj = { creditCode: c.v }, acc = {};
        if (chosen) subj.companyName = chosen.name;
        const nextCode = (k + 1 < codes.length) ? codes[k + 1].i : text.length;
        let nextName = text.length; for (const np of namePos) { if (np.i >= codeEnd) { nextName = np.i; break; } }
        const detail = text.slice(codeEnd, Math.min(nextCode, nextName, text.length));
        const rep = detail.match(/(?:法定代表人|法人代表|法人)[：:\s]*([\u4e00-\u9fa5]{2,4})/); if (rep) subj.legalRepName = rep[1];
        const phone = detail.match(/1[3-9]\d{9}/); if (phone) subj.legalRepPhone = phone[0];
        const idc = detail.match(/\d{17}[\dXx]/); if (idc) subj.legalRepIdNo = idc[0];
        const region = REGIONS.find((r) => r.name !== '全国统一（新电子税务局）' && (detail.indexOf(r.name) >= 0 || text.slice(Math.max(0, c.i - 20), c.i).indexOf(r.name) >= 0));
        if (region) acc.region = region.name;
        const isGen = /一般户|一般账户/.test(detail);
        const bank = detail.match(/(?:开户行|开户银行)[：:\s]*([^\s，,。；;\n]{2,30})/); if (bank) { if (isGen) acc.generalBankName = cleanVal(bank[1]); else acc.basicBankName = cleanVal(bank[1]); }
        const acct = detail.match(/(?:账号|卡号)[：:\s]*([0-9][0-9\s]{6,30})/); if (acct) { const v = acct[1].replace(/\s/g, ''); if (isGen) acc.generalAccountNo = v; else acc.basicAccountNo = v; }
        if (Object.keys(subj).length > 1 || Object.keys(acc).length) recs.push({ subj, acc });
      }
      return recs;
    }
    function parseImport(text) {
      const norm = String(text || '').replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ');
      const structured = parseStructured(norm);
      if (structured) return structured;
      const allLines = norm.split('\n');
      const nonEmpty = allLines.map((l) => l.trim()).filter(Boolean);
      const table = tryTable(nonEmpty);
      if (table) return table;
      const blocks = []; let cur = [], nameLinesInBlock = 0;
      const flush = () => { if (cur.some((l) => l.trim())) blocks.push(cur.join('\n')); cur = []; };
      const isNameLine = (l) => /^\s*(公司名称|企业名称|单位名称|客户名称|名称|客户|公司)\s*[:：]/.test(l);
      allLines.forEach((line) => {
        if (!line.trim()) { flush(); nameLinesInBlock = 0; return; }
        if (isNameLine(line) && nameLinesInBlock >= 1) { flush(); nameLinesInBlock = 0; }
        if (isNameLine(line)) nameLinesInBlock++;
        cur.push(line);
      });
      flush();
      const labeled = blocks.map((b) => extractFields(b)).filter((r) => Object.keys(r.subj).length || Object.keys(r.acc).length);
      const codeCount = (norm.match(/[0-9A-Z]{18}/g) || []).filter((v) => (v.match(/\d/g) || []).length >= 8).length;
      if (labeled.length <= 1 && codeCount > 1) { const ff = parseFreeformByCodes(norm); if (ff.length) return ff; }
      if (labeled.length) return labeled;
      return parseFreeformByCodes(norm);
    }

    /* ============================ styles ============================ */
    const CSS = [
      ".opcv-root, .opcv-root *{ box-sizing: border-box; }",
      ".opcv-root{",
      "  position: relative; height: 100%; width: 100%; overflow: auto;",
      "  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);",
      "  font-family: -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif;",
      "  font-size: 13px; line-height: 1.55; -webkit-font-smoothing: antialiased;",
      "}",
      ".opcv-shell{ max-width: 1120px; margin: 0 auto; padding: 26px 32px 96px; }",
      ".opcv-mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .2px; }",
      ".opcv-center{ min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 48px 16px; }",
      ".opcv-auth{ width: 100%; max-width: 392px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 32px 28px; }",
      ".opcv-authicon{ display: flex; justify-content: center; margin-bottom: 12px; }",
      ".opcv-h2{ font-size: 20px; font-weight: 650; letter-spacing: -.01em; margin: 6px 0 6px; text-align: center; }",
      ".opcv-muted{ color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; margin: 0 0 20px; line-height: 1.6; }",
      ".opcv-auth .opcv-input{ margin-bottom: 10px; }",
      ".opcv-strength{ height: 4px; border-radius: 7px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; margin: 2px 0 14px; }",
      ".opcv-strength > i{ display:block; height:100%; width:0; transition: width 160ms ease-out; }",
      ".opcv-check{ display:flex; align-items:center; gap:8px; font-size:12px; color: var(--dsw-alias-label-secondary); margin: 2px 0 16px; cursor:pointer; }",
      ".opcv-err{ color: var(--dsw-alias-state-error-primary); font-size:12px; min-height:16px; margin: 2px 0 8px; }",
      ".opcv-header{ display:flex; align-items:center; gap:14px; margin-bottom: 18px; }",
      ".opcv-brand{ display:flex; align-items:center; gap:12px; min-width:0; }",
      ".opcv-brandicon{ display:flex; flex:0 0 auto; }",
      ".opcv-title{ font-size:15px; font-weight:650; letter-spacing:-.01em; margin:0; line-height:1.2; }",
      ".opcv-sub{ font-size:12px; color: var(--dsw-alias-label-secondary); margin-top:3px; }",
      ".opcv-hactions{ margin-left:auto; display:flex; align-items:center; gap:8px; }",
      ".opcv-save{ font-size:12px; color: var(--dsw-alias-label-secondary); }",
      ".opcv-toolbar{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:16px; }",
      ".opcv-spacer{ flex:1; }",
      ".opcv-btn{ display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 12px; border-radius:7px; border:1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size:13px; font-family:inherit; cursor:pointer; transition: background 150ms ease-out, border-color 150ms ease-out, transform 150ms ease-out; }",
      ".opcv-btn:hover{ background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }",
      ".opcv-btn:active{ transform: scale(.98); }",
      ".opcv-btn:focus-visible{ outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }",
      ".opcv-btn:disabled{ opacity:.45; cursor:not-allowed; }",
      ".opcv-primary{ background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color:#fff; }",
      ".opcv-primary:hover{ background: var(--dsw-alias-brand-primary); filter: brightness(1.06); border-color: var(--dsw-alias-brand-primary); }",
      ".opcv-small{ height:30px; padding:0 10px; font-size:12px; }",
      ".opcv-iconbtn{ display:inline-flex; align-items:center; justify-content:center; height:30px; width:30px; border-radius:7px; border:1px solid var(--dsw-alias-border-l1); background:transparent; color: var(--dsw-alias-label-secondary); cursor:pointer; transition: background 150ms ease-out, color 150ms ease-out; }",
      ".opcv-iconbtn:hover{ background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }",
      ".opcv-iconbtn:focus-visible{ outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }",
      ".opcv-input{ width:100%; height:36px; padding:0 12px; border-radius:7px; border:1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size:13px; font-family:inherit; outline:none; transition: border-color 150ms ease-out, box-shadow 150ms ease-out; }",
      ".opcv-input:hover{ border-color: var(--dsw-alias-border-l2); }",
      ".opcv-input:focus{ border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 15%, transparent); }",
      ".opcv-textarea{ height:auto; min-height:60px; padding:9px 12px; resize:vertical; line-height:1.55; }",
      "select.opcv-input{ cursor:pointer; }",
      ".opcv-tabs{ display:flex; gap:2px; border-bottom:1px solid var(--dsw-alias-border-l1); margin-bottom:20px; }",
      ".opcv-tab{ padding:9px 14px; border:none; background:transparent; color: var(--dsw-alias-label-secondary); font-size:13px; font-family:inherit; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; transition: color 150ms ease-out, border-color 150ms ease-out; }",
      ".opcv-tab:hover{ color: var(--dsw-alias-label-primary); }",
      ".opcv-tab:focus-visible{ outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-2px; border-radius:7px; }",
      ".opcv-tab.active{ color: var(--dsw-alias-brand-primary); border-bottom-color: var(--dsw-alias-brand-primary); font-weight:600; }",
      ".opcv-split{ display:grid; grid-template-columns: 244px minmax(0,1fr); gap:24px; align-items:start; }",
      ".opcv-list{ display:flex; flex-direction:column; gap:4px; }",
      ".opcv-listhead{ display:flex; align-items:center; gap:8px; margin-bottom:4px; }",
      ".opcv-listhead > span{ font-size:13px; font-weight:650; }",
      ".opcv-listhead .opcv-btn{ margin-left:auto; }",
      ".opcv-listitem{ display:flex; flex-direction:column; gap:2px; padding:9px 12px; border-radius:7px; border:1px solid transparent; background:transparent; color: var(--dsw-alias-label-primary); cursor:pointer; text-align:left; width:100%; transition: background 150ms ease-out, border-color 150ms ease-out; }",
      ".opcv-listitem:hover{ background: var(--dsw-alias-bg-layer-1); }",
      ".opcv-listitem.active{ background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l2); }",
      ".opcv-listitem:focus-visible{ outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }",
      ".opcv-li-name{ font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }",
      ".opcv-li-meta{ font-size:12px; color: var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }",
      ".opcv-detail{ min-width:0; }",
      ".opcv-detailhead{ display:flex; align-items:center; gap:10px; margin-bottom:16px; }",
      ".opcv-detailtitle{ font-size:20px; font-weight:650; letter-spacing:-.01em; margin:0; }",
      ".opcv-detailhead .opcv-btn.del{ margin-left:auto; color: var(--dsw-alias-state-error-primary); }",
      ".opcv-detailhead .opcv-btn.del:hover{ background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); border-color: var(--dsw-alias-state-error-primary); }",
      ".opcv-card{ background: var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:14px; padding:4px 18px; margin-bottom:16px; }",
      ".opcv-cardtitle{ display:flex; align-items:center; gap:8px; font-size:12px; font-weight:600; letter-spacing:.02em; color: var(--dsw-alias-label-secondary); padding:14px 0 8px; }",
      ".opcv-field{ display:grid; grid-template-columns: 200px minmax(0,1fr); gap:16px; align-items:start; padding:12px 0; border-bottom:0.5px solid var(--dsw-alias-border-l1); }",
      ".opcv-field:last-child{ border-bottom:none; }",
      ".opcv-flabel{ padding-top:8px; font-size:12px; color: var(--dsw-alias-label-secondary); display:flex; align-items:center; gap:6px; flex-wrap:wrap; }",
      ".opcv-badge{ font-size:12px; line-height:1; padding:2px 6px; border-radius:7px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }",
      ".opcv-badge-mono{ font-family: ui-monospace, monospace; }",
      ".opcv-fval{ min-width:0; }",
      ".opcv-inrow{ display:flex; gap:8px; align-items:flex-start; }",
      ".opcv-inrow > .opcv-input{ flex:1; }",
      ".opcv-fieldactions{ display:flex; gap:6px; flex-shrink:0; padding-top:3px; }",
      ".opcv-imgrow{ display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; }",
      ".opcv-imgzone{ flex:1; min-width:200px; min-height:66px; display:flex; align-items:center; justify-content:center; border:1px dashed var(--dsw-alias-border-l2); border-radius:10px; padding:8px; cursor:pointer; background: var(--dsw-alias-bg-layer-2); transition: border-color 150ms ease-out; }",
      ".opcv-imgzone:hover{ border-color: var(--dsw-alias-brand-primary); }",
      ".opcv-imgempty{ color: var(--dsw-alias-label-secondary); font-size:12px; text-align:center; padding:6px; }",
      ".opcv-thumb{ max-height:120px; max-width:100%; border-radius:7px; object-fit:contain; cursor:zoom-in; }",
      ".opcv-imgbtns{ display:flex; flex-direction:column; gap:6px; }",
      ".opcv-chips{ display:flex; flex-wrap:wrap; gap:6px; }",
      ".opcv-chip{ display:inline-flex; align-items:center; gap:6px; padding:3px 10px; border-radius:7px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size:12px; }",
      ".opcv-linkgrid{ display:flex; flex-direction:column; gap:2px; padding:6px 0; }",
      ".opcv-linkrow{ display:flex; align-items:center; gap:9px; font-size:13px; cursor:pointer; padding:6px 4px; border-radius:7px; }",
      ".opcv-linkrow:hover{ background: var(--dsw-alias-bg-layer-2); }",
      ".opcv-summary{ display:grid; grid-template-columns: repeat(4, 1fr); border:1px solid var(--dsw-alias-border-l1); border-radius:14px; background: var(--dsw-alias-bg-layer-1); overflow:hidden; margin-bottom:20px; }",
      ".opcv-stat{ padding:16px 18px; border-left:0.5px solid var(--dsw-alias-border-l1); }",
      ".opcv-stat:first-child{ border-left:none; }",
      ".opcv-statnum{ font-size:20px; font-weight:650; letter-spacing:-.01em; line-height:1.1; }",
      ".opcv-statlabel{ font-size:12px; color: var(--dsw-alias-label-secondary); margin-top:5px; }",
      ".opcv-relrow{ display:grid; grid-template-columns: 220px minmax(0,1fr); gap:16px; padding:11px 0; border-bottom:0.5px solid var(--dsw-alias-border-l1); align-items:center; }",
      ".opcv-relrow:last-child{ border-bottom:none; }",
      ".opcv-relname{ font-weight:600; font-size:13px; }",
      ".opcv-toast{ position:fixed; left:50%; bottom:32px; transform: translateX(-50%); background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); padding:9px 16px; border-radius:10px; font-size:12px; z-index:1000; opacity:0; transition: opacity 160ms ease-out; pointer-events:none; }",
      ".opcv-toast.show{ opacity:.96; }",
      ".opcv-overlay{ position:fixed; inset:0; background: rgba(0,0,0,.5); z-index:1000; display:flex; align-items:center; justify-content:center; padding:24px; }",
      ".opcv-modal{ background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)); border:1px solid var(--dsw-alias-border-l2); border-radius:14px; width:100%; max-width:560px; max-height:86vh; overflow:auto; box-shadow: 0 16px 48px rgba(0,0,0,.22); }",
      ".opcv-modalhead{ display:flex; align-items:center; gap:10px; padding:16px 20px; border-bottom:0.5px solid var(--dsw-alias-border-l1); }",
      ".opcv-modalTitle{ font-size:15px; font-weight:650; margin:0; flex:1; }",
      ".opcv-modalbody{ padding:18px 20px; font-size:13px; }",
      ".opcv-modalbody .opcv-input{ margin-bottom:10px; }",
      ".opcv-viewimg{ max-width:100%; max-height:64vh; display:block; margin:0 auto; border-radius:7px; }",
      ".opcv-pre{ white-space:pre-wrap; word-break:break-word; background: var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l1); border-radius:10px; padding:12px; font-size:12px; max-height:240px; overflow:auto; font-family: ui-monospace, monospace; line-height:1.6; }",
      ".opcv-hint{ font-size:12px; color: var(--dsw-alias-label-secondary); margin:6px 0 10px; line-height:1.6; }",
      ".opcv-empty{ color: var(--dsw-alias-label-secondary); font-size:13px; padding:20px 4px; text-align:center; }",
            "@media (max-width: 760px){",
      "  .opcv-shell{ padding:18px 16px 88px; }",
      "  .opcv-header{ gap:10px; margin-bottom:14px; flex-wrap:wrap; }",
      "  .opcv-sub{ display:none; }",
      "  .opcv-hactions .opcv-save{ display:none; }",
      "  .opcv-toolbar{ gap:6px; }",
      "  .opcv-btn{ height:32px; padding:0 10px; }",
      "  .opcv-split{ grid-template-columns:1fr; gap:14px; }",
      "  .opcv-list{ flex-direction:row; overflow-x:auto; padding-bottom:6px; -webkit-overflow-scrolling:touch; }",
      "  .opcv-listitem{ min-width:180px; flex:0 0 auto; }",
      "  .opcv-detailhead{ flex-wrap:wrap; gap:8px; }",
      "  .opcv-detailtitle{ font-size:16px; width:100%; }",
      "  .opcv-detailhead .opcv-btn.del{ margin-left:0; }",
      "  .opcv-field{ grid-template-columns:1fr; gap:6px; }",
      "  .opcv-flabel{ padding-top:0; }",
      "  .opcv-summary{ grid-template-columns: repeat(2, 1fr); }",
      "  .opcv-stat:nth-child(n+3){ border-top:0.5px solid var(--dsw-alias-border-l1); }",
      "  .opcv-stat:nth-child(3){ border-left:none; }",
      "  .opcv-relrow{ grid-template-columns:1fr; gap:8px; }",
      "  .opcv-linkrow{ align-items:flex-start; }",
      "  .opcv-linkrow > span{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
      "}",
"@media (prefers-reduced-motion: reduce){",
      "  .opcv-root *{ transition:none !important; animation:none !important; }",
      "}",
    ].join('\n');

    /* ============================ boot ============================ */
    function boot(root) {
      const state = {
        mode: 'loading', meta: null, dek: null,
        data: null,            // { v:2, subjects:[], accountSets:[], customFields:[] }
        view: 'overview',
        activeSubject: null, activeAccount: null,
        armedImage: null,
      };
      let shell = null, contentHost = null, saveIndicator = null, tabsHost = null;
      let saveTimer = null, idleInt = null, lastActivity = Date.now(), toastEl = null, toastTimer = null;
      const globalOff = [];

      root.classList.add('opcv-root');
      root.innerHTML = ''; // clean any previous mount (StrictMode / panel re-entry)
      shell = E('div', { class: 'opcv-shell' });
      root.appendChild(shell);
      toastEl = E('div', { class: 'opcv-toast' });
      root.appendChild(toastEl);
      function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900); }

      const bump = () => { lastActivity = Date.now(); };
      root.addEventListener('keydown', bump); globalOff.push(['keydown', bump]);
      root.addEventListener('pointerdown', bump); globalOff.push(['pointerdown', bump]);
      root.addEventListener('input', bump); globalOff.push(['input', bump]);
      const pasteHandler = (ev) => {
        if (state.mode !== 'app' || !state.armedImage) return;
        const items = (ev.clipboardData && ev.clipboardData.items) || [];
        for (const it of items) {
          if (it.type && it.type.indexOf('image/') === 0) {
            const file = it.getAsFile();
            if (file) { ev.preventDefault(); const tgt = state.armedImage; readImageFile(file, tgt.record, tgt.key); return; }
          }
        }
      };
      root.addEventListener('paste', pasteHandler); globalOff.push(['paste', pasteHandler]);
      idleInt = setInterval(() => { if (state.mode === 'app' && Date.now() - lastActivity > IDLE_LOCK_MS) lock('已因长时间无操作自动锁定'); }, 15000);

      /* ---------- ids / accessors ---------- */
      function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
      function getSubject(id) { return (state.data.subjects || []).find((s) => s.id === id) || null; }
      function getAccount(id) { return (state.data.accountSets || []).find((a) => a.id === id) || null; }
      function relCount() { return (state.data.accountSets || []).reduce((n, a) => n + (a.subjectIds ? a.subjectIds.length : 0), 0); }

      /* ---------- persistence ---------- */
      function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 600); }
      async function saveNow() {
        if (!state.dek || !state.data) return;
        try { state.data.updatedAt = Date.now(); const payload = await encryptObject(state.dek, state.data); await idbSet('vault', payload); if (saveIndicator) saveIndicator.textContent = '已保存'; }
        catch (e) { if (saveIndicator) saveIndicator.textContent = '保存失败'; }
      }

      /* ---------- top-level render ---------- */
      function render() {
        if (!shell) return;
        shell.innerHTML = ''; contentHost = tabsHost = saveIndicator = null;
        if (state.mode === 'loading') { shell.appendChild(E('div', { class: 'opcv-empty', text: '正在加载…' })); return; }
        if (state.mode === 'create') return renderCreate();
        if (state.mode === 'unlock') return renderUnlock();
        if (state.mode === 'app') return renderApp();
      }

      /* ---------- auth screens ---------- */
      function renderCreate() {
        const wrap = E('div', { class: 'opcv-center' });
        const card = E('div', { class: 'opcv-auth' });
        card.appendChild(E('div', { class: 'opcv-authicon', html: SHIELD_BIG }));
        card.appendChild(E('h2', { class: 'opcv-h2', text: '创建 OPC Vault' }));
        card.appendChild(E('p', { class: 'opcv-muted', text: '设置主密码。OPC Vault 把企业资料、财税、银行账户等统一收入本地加密库——这只是基础，还可扩展证照印章、资质知识产权、经营合规等。所有数据仅保存在本机，AES-256-GCM 加密，不上传服务器。' }));
        const pw = E('input', { class: 'opcv-input', props: { type: 'password', placeholder: '设置主密码（至少 8 位）', autocomplete: 'new-password' } });
        const pw2 = E('input', { class: 'opcv-input', props: { type: 'password', placeholder: '再次输入主密码', autocomplete: 'new-password' } });
        const strength = E('div', { class: 'opcv-strength' }, E('i')); const bar = strength.firstChild;
        const err = E('div', { class: 'opcv-err' });
        const cb = E('input', { props: { type: 'checkbox', id: 'opcv-pk' } });
        const check = E('label', { class: 'opcv-check', attrs: { for: 'opcv-pk' } }, cb, E('span', { text: '同时启用 Passkey 快捷解锁（可选，需设备支持）' }));
        const btn = E('button', { class: 'opcv-btn opcv-primary', style: 'width:100%;height:38px;justify-content:center;font-size:13.5px;', text: '创建并进入' });
        const score = (v) => { let s = 0; if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++; return Math.min(s, 4); };
        pw.addEventListener('input', () => { const s = score(pw.value); const c = ['transparent', 'var(--dsw-alias-state-error-primary)', 'var(--dsw-alias-state-warn-primary)', 'var(--dsw-alias-state-success-primary)', 'var(--dsw-alias-state-success-primary)']; bar.style.width = (s === 0 ? 0 : s * 25) + '%'; bar.style.background = c[s] || 'transparent'; });
        btn.addEventListener('click', async () => {
          err.textContent = ''; const p1 = pw.value, p2 = pw2.value;
          if (p1.length < 8) { err.textContent = '主密码至少 8 位'; return; }
          if (p1 !== p2) { err.textContent = '两次输入的密码不一致'; return; }
          btn.disabled = true; btn.textContent = '创建中…';
          try {
            const salt = randomBytes(SALT_BYTES); const dek = await generateDEK();
            const kek = await deriveKEK(p1, salt); const wrapped = await wrapDEK(dek, kek);
            const meta = { app: 'opc-vault', v: 2, kdf: 'pbkdf2-sha256-600000', saltB64: bufToB64(salt), wrappedDEK: wrapped, createdAt: Date.now() };
            if (cb.checked && passkeyEligible()) { try { const pk = await registerPasskey(dek); if (pk.ok) meta.passkey = pk.record; else if (pk.reason === 'PRF_NOT_SUPPORTED') toast('此设备暂不支持 Passkey PRF，已跳过'); } catch (e) { toast('Passkey 未完成：' + (e && e.message ? e.message : e)); } }
            state.dek = dek; state.meta = meta;
            state.data = { v: 2, subjects: [], accountSets: [], customFields: [], taxProfiles: {}, apiKeys: [], updatedAt: Date.now() };
            await idbSet('meta', meta); await saveNow();
            state.mode = 'app'; state.view = 'overview'; lastActivity = Date.now();
            render(); toast('账套库已创建，数据仅保存在本机');
          } catch (e) { err.textContent = '创建失败：' + (e && e.message ? e.message : e); btn.disabled = false; btn.textContent = '创建并进入'; }
        });
        card.appendChild(pw); card.appendChild(strength); card.appendChild(pw2); card.appendChild(err);
        if (passkeyEligible()) { card.appendChild(check); }
        else { card.appendChild(E('div', { class: 'opcv-hint', text: '当前环境不支持 Passkey（需 HTTPS 或 http://localhost，且浏览器支持 WebAuthn PRF；macOS 建议用 Chrome）。可先用主密码，不影响使用。' })); }
        card.appendChild(btn);
        wrap.appendChild(card); shell.appendChild(wrap); setTimeout(() => pw.focus(), 30);
      }

      function renderUnlock() {
        const wrap = E('div', { class: 'opcv-center' });
        const card = E('div', { class: 'opcv-auth' });
        card.appendChild(E('div', { class: 'opcv-authicon', html: SHIELD_BIG }));
        card.appendChild(E('h2', { class: 'opcv-h2', text: '解锁 OPC Vault' }));
        card.appendChild(E('p', { class: 'opcv-muted', text: '本机加密存储 · 请输入主密码' + (state.meta && state.meta.passkey ? '，或使用 Passkey' : '') }));
        const pw = E('input', { class: 'opcv-input', props: { type: 'password', placeholder: '主密码', autocomplete: 'current-password' } });
        const err = E('div', { class: 'opcv-err' });
        const btn = E('button', { class: 'opcv-btn opcv-primary', style: 'width:100%;height:38px;justify-content:center;font-size:13.5px;', text: '解锁' });
        const go = async () => {
          err.textContent = ''; if (!pw.value) { err.textContent = '请输入主密码'; return; }
          btn.disabled = true; btn.textContent = '解锁中…';
          try {
            const kek = await deriveKEK(pw.value, b64ToBuf(state.meta.saltB64));
            let dek; try { dek = await unwrapDEK(state.meta.wrappedDEK.iv, state.meta.wrappedDEK.wrapped, kek); }
            catch (e) { err.textContent = '主密码错误'; btn.disabled = false; btn.textContent = '解锁'; return; }
            await finishUnlock(dek);
          } catch (e) { err.textContent = '解锁失败：' + (e && e.message ? e.message : e); btn.disabled = false; btn.textContent = '解锁'; }
        };
        btn.addEventListener('click', go); pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        card.appendChild(pw); card.appendChild(err); card.appendChild(btn);
        if (state.meta && state.meta.passkey) {
          const pk = E('button', { class: 'opcv-btn', style: 'width:100%;height:36px;justify-content:center;margin-top:10px;', html: ICON.key + '<span>使用 Passkey 解锁</span>' });
          pk.addEventListener('click', async () => { err.textContent = ''; if (!passkeyEligible()) { err.textContent = passkeyHint(); return; } try { const dek = await unlockWithPasskey(); await finishUnlock(dek); toast('已通过 Passkey 解锁'); } catch (e) { err.textContent = 'Passkey 解锁失败：' + (e && e.message ? e.message : e); } });
          card.appendChild(pk);
        }
        wrap.appendChild(card); shell.appendChild(wrap); setTimeout(() => pw.focus(), 30);
      }

      function migrate(data) {
        if (!data || data.v === 2 || Array.isArray(data.subjects)) return data;
        // v1 flat -> v2: one subject + one account set built from old fields
        const sKeys = subjectKeys(), aKeys = accountKeys();
        const subject = { id: uid('s'), values: {} };
        const account = { id: uid('a'), values: { name: '默认账套' }, subjectIds: [subject.id] };
        const old = data.fields || {};
        Object.keys(old).forEach((k) => { if (sKeys.has(k)) subject.values[k] = old[k]; else if (aKeys.has(k)) account.values[k] = old[k]; });
        if (data.region && account.values) account.values.region = data.region;
        return { v: 2, subjects: [subject], accountSets: [account], customFields: data.customFields || [], updatedAt: Date.now() };
      }

      async function finishUnlock(dek) {
        state.dek = dek;
        const payload = await idbGet('vault');
        let data = payload ? await decryptObject(dek, payload) : { v: 2, subjects: [], accountSets: [], customFields: [], taxProfiles: {}, apiKeys: [], updatedAt: Date.now() };
        data = migrate(data);
        if (!data.subjects) data.subjects = [];
        if (!data.accountSets) data.accountSets = [];
        if (!data.customFields) data.customFields = [];
        state.data = data;
        if (!state.data.taxProfiles) state.data.taxProfiles = {};
        if (!Array.isArray(state.data.apiKeys)) state.data.apiKeys = [];
        state.mode = 'app'; state.view = 'overview'; lastActivity = Date.now();
        render();
      }

      function lock(msg) {
        state.dek = null; state.data = null; state.armedImage = null; state.activeSubject = null; state.activeAccount = null;
        state.mode = 'unlock'; render(); if (msg) toast(msg);
      }

      /* ---------- app shell ---------- */
      function renderApp() {
        if (shell) shell.innerHTML = ''; // clear previous screen (renderApp may be called directly, e.g. tab switch / after import)
        const app = E('div');
        const header = E('div', { class: 'opcv-header' });
        header.appendChild(E('div', { class: 'opcv-brand' },
          E('div', { class: 'opcv-brandicon', html: SHIELD_BIG }),
          E('div', { class: 'opcv-brandtext' },
            E('h1', { class: 'opcv-title', text: 'OPC Vault' }),
            E('div', { class: 'opcv-sub', text: '公司主体 ' + state.data.subjects.length + ' · 账套 ' + state.data.accountSets.length + ' · 关联 ' + relCount() + ' · 本地加密存储' })
          )
        ));
        saveIndicator = E('span', { class: 'opcv-save', text: '已保存' });
        const lockBtn = E('button', { class: 'opcv-btn', html: ICON.lock + '<span>锁定</span>' });
        lockBtn.addEventListener('click', () => lock('已锁定'));
        header.appendChild(E('div', { class: 'opcv-hactions' }, saveIndicator, lockBtn));
        app.appendChild(header);

        // toolbar
        const bar = E('div', { class: 'opcv-toolbar' });
        const exportBtn = E('button', { class: 'opcv-btn', html: ICON.download + '<span>导出</span>' }); exportBtn.addEventListener('click', exportVault);
        const importBtn = E('button', { class: 'opcv-btn', html: ICON.upload + '<span>导入</span>' }); importBtn.addEventListener('click', importVault);
        const pwBtn = E('button', { class: 'opcv-btn', html: ICON.key + '<span>修改密码</span>' }); pwBtn.addEventListener('click', openChangePassword);
        const bulkBtn = E('button', { class: 'opcv-btn', html: ICON.upload + '<span>批量导入</span>' }); bulkBtn.addEventListener('click', openBulkImport);
        const licenseBtn = E('button', { class: 'opcv-btn', html: ICON.scan + '<span>营业执照识别</span>' }); licenseBtn.addEventListener('click', openLicenseImport);
        bar.appendChild(licenseBtn); bar.appendChild(bulkBtn); bar.appendChild(exportBtn); bar.appendChild(importBtn); bar.appendChild(pwBtn);
        const ecoBtn = E('button', { class: 'opcv-btn', text: 'OPC 生态' }); ecoBtn.addEventListener('click', openEcosystem); bar.appendChild(ecoBtn);
        if (!state.meta.passkey) {
          const pk = E('button', { class: 'opcv-btn', html: ICON.key + '<span>启用 Passkey</span>' });
          if (passkeyEligible()) { pk.addEventListener('click', enablePasskey); bar.appendChild(pk); }
          else {
            pk.disabled = true; pk.style.opacity = '.45'; pk.style.cursor = 'not-allowed'; pk.title = passkeyHint();
            bar.appendChild(pk);
            const why = E('button', { class: 'opcv-btn opcv-small', text: '为什么无法启用 Passkey？' });
            why.addEventListener('click', showPasskeyHelp); bar.appendChild(why);
          }
        }
        app.appendChild(bar);

        // tabs
        tabsHost = E('div', { class: 'opcv-tabs' });
        [['overview', '概览'], ['subjects', '公司主体'], ['accounts', '账套'], ['relations', '关系'], ['tax', '税务'], ['keys', '密钥']].forEach(([v, label]) => {
          const t = E('button', { class: 'opcv-tab' + (state.view === v ? ' active' : ''), text: label });
          t.addEventListener('click', () => { state.view = v; renderApp(); });
          tabsHost.appendChild(t);
        });
        app.appendChild(tabsHost);

        contentHost = E('div');
        app.appendChild(contentHost);
        shell.appendChild(app);

        if (state.view === 'overview') renderOverview();
        else if (state.view === 'subjects') renderSubjects();
        else if (state.view === 'accounts') renderAccounts();
        else if (state.view === 'tax') renderTax();
        else if (state.view === 'keys') renderApiKeys();
        else renderRelations();
      }

      /* ---------- overview ---------- */
      function renderOverview() {
        contentHost.innerHTML = '';
        const sum = E('div', { class: 'opcv-summary' });
        const stat = (n, label) => E('div', { class: 'opcv-stat' }, E('div', { class: 'opcv-statnum', text: String(n) }), E('div', { class: 'opcv-statlabel', text: label }));
        sum.appendChild(stat(state.data.subjects.length, '公司主体'));
        sum.appendChild(stat(state.data.accountSets.length, '账套'));
        sum.appendChild(stat(relCount(), '主体·账套 关联（多对多）'));
        const filled = state.data.accountSets.filter((a) => String(a.values.name || '').trim()).length;
        sum.appendChild(stat(filled, '已命名账套'));
        contentHost.appendChild(sum);

        contentHost.appendChild(E('div', { class: 'opcv-hint', text: 'OPC Vault 是企业资料与财税运营中枢：企业信息、财税、银行账户只是基础，还可管理证照印章、资质知识产权、经营合规等。公司主体是营业执照对应的法律实体；账套是独立核算的账务数据集。同一主体可对应多个账套，一个账套也可关联多个主体（多对多）。' }));
        const ecoHint = E('div', { class: 'opcv-muted', style: 'margin:6px 0 14px;text-align:left;cursor:pointer;', text: '下一步：把资产、财务、订阅、文档接进来 → 了解 OPC 生态（Business OS / Agent）' }); ecoHint.addEventListener('click', openEcosystem); contentHost.appendChild(ecoHint);

        const c1 = E('div', { class: 'opcv-card' });
        c1.appendChild(E('div', { class: 'opcv-cardtitle', text: '公司主体' }));
        if (state.data.subjects.length === 0) c1.appendChild(E('div', { class: 'opcv-empty', text: '还没有公司主体，去「公司主体」新建。' }));
        state.data.subjects.forEach((s) => {
          const row = E('div', { class: 'opcv-relrow' });
          row.appendChild(E('div', { class: 'opcv-relname', text: s.values.companyName || '未命名主体' }));
          const chips = E('div', { class: 'opcv-chips' });
          const sets = state.data.accountSets.filter((a) => (a.subjectIds || []).includes(s.id));
          if (sets.length === 0) chips.appendChild(E('span', { class: 'opcv-muted', style: 'margin:0;text-align:left;', text: '未关联账套' }));
          sets.forEach((a) => chips.appendChild(E('span', { class: 'opcv-chip', text: (a.values.name || '未命名账套') })));
          row.appendChild(chips); c1.appendChild(row);
        });
        contentHost.appendChild(c1);

        if (state.data.subjects.length === 0 && state.data.accountSets.length === 0) {
          const qs = E('div', { class: 'opcv-card' });
          qs.appendChild(E('div', { class: 'opcv-cardtitle', text: '快速开始' }));
          qs.appendChild(E('div', { class: 'opcv-hint', text: '已有资料？把所有公司信息一次性粘贴进来，自动识别并创建多个公司主体与账套（支持“字段：值”多段、Excel 表格）。' }));
          const b = E('button', { class: 'opcv-btn opcv-primary', html: ICON.upload + '<span>批量粘贴导入</span>' });
          b.addEventListener('click', openBulkImport); qs.appendChild(b);
          const lb = E('button', { class: 'opcv-btn', html: ICON.scan + '<span>上传营业执照识别</span>', style: 'margin-left:8px;' });
          lb.addEventListener('click', openLicenseImport); qs.appendChild(lb);
          contentHost.appendChild(qs);
        }
      }

      /* ---------- subjects ---------- */
      function renderSubjects() {
        contentHost.innerHTML = '';
        const split = E('div', { class: 'opcv-split' });
        // list
        const listWrap = E('div');
        const lh = E('div', { class: 'opcv-listhead' });
        lh.appendChild(E('span', { style: 'font-weight:650;font-size:13px;', text: '公司主体' }));
        const addBtn = E('button', { class: 'opcv-btn opcv-small', html: ICON.plus + '<span>新建</span>' });
        addBtn.addEventListener('click', addSubject);
        lh.appendChild(addBtn); listWrap.appendChild(lh);
        const list = E('div', { class: 'opcv-list' });
        if (state.data.subjects.length === 0) list.appendChild(E('div', { class: 'opcv-empty', text: '暂无主体' }));
        state.data.subjects.forEach((s) => {
          const item = E('button', { class: 'opcv-listitem' + (state.activeSubject === s.id ? ' active' : '') },
            E('div', { class: 'opcv-li-name', text: s.values.companyName || '未命名主体' }),
            E('div', { class: 'opcv-li-meta', text: s.values.creditCode || '未填统一社会信用代码' })
          );
          item.addEventListener('click', () => { state.activeSubject = s.id; renderSubjects(); });
          list.appendChild(item);
        });
        listWrap.appendChild(list);
        split.appendChild(listWrap);

        // detail
        const detail = E('div', { class: 'opcv-detail' });
        let subj = getSubject(state.activeSubject);
        if (!subj && state.data.subjects.length) { subj = state.data.subjects[0]; state.activeSubject = subj.id; }
        if (!subj) {
          detail.appendChild(E('div', { class: 'opcv-empty', text: '请新建一个公司主体。' }));
        } else {
          const head = E('div', { class: 'opcv-detailhead' });
          head.appendChild(E('h3', { class: 'opcv-detailtitle', text: subj.values.companyName || '未命名主体' }));
          const del = E('button', { class: 'opcv-btn opcv-small del', html: ICON.trash + '<span>删除主体</span>' });
          del.addEventListener('click', () => deleteSubject(subj.id));
          head.appendChild(del);
          detail.appendChild(head);
          // related account sets
          const relCard = E('div', { class: 'opcv-card' });
          relCard.appendChild(E('div', { class: 'opcv-cardtitle', text: '所属账套（多对多，只读）' }));
          const chips = E('div', { class: 'opcv-chips' });
          const sets = state.data.accountSets.filter((a) => (a.subjectIds || []).includes(subj.id));
          if (!sets.length) chips.appendChild(E('span', { class: 'opcv-muted', style: 'margin:0;text-align:left;', text: '尚未被任何账套关联，可在「账套」里关联本主体。' }));
          sets.forEach((a) => { const c = E('span', { class: 'opcv-chip', text: (a.values.name || '未命名账套') }); c.style.cursor = 'pointer'; c.addEventListener('click', () => { state.view = 'accounts'; state.activeAccount = a.id; renderApp(); }); chips.appendChild(c); });
          relCard.appendChild(chips); detail.appendChild(relCard);
          SUBJECT_GROUPS.forEach((g) => detail.appendChild(groupCard(subj, g)));
        }
        split.appendChild(detail);
        contentHost.appendChild(split);
      }

      /* ---------- API 密钥（分类 / 一键复制 / 本地 Agent） ---------- */
      const KEY_PROVIDERS = [
        [/(OPENAI|OPEN_AI)/i, 'OpenAI', 'llm'], [/(ANTHROPIC|CLAUDE)/i, 'Anthropic', 'llm'],
        [/(DEEPSEEK)/i, 'DeepSeek', 'llm'], [/(GEMINI|GOOGLE_GENAI|GOOGLE_AI)/i, 'Google Gemini', 'llm'],
        [/(MOONSHOT|KIMI)/i, 'Moonshot 月之暗面', 'llm'], [/(DASHSCOPE|QWEN|BAILIAN)/i, '阿里云百炼/通义', 'llm'],
        [/(ZHIPU|GLM|BIGMODEL)/i, '智谱 GLM', 'llm'], [/(XAI|GROK)/i, 'xAI Grok', 'llm'],
        [/(MISTRAL)/i, 'Mistral', 'llm'], [/(COHERE)/i, 'Cohere', 'llm'], [/(OPENROUTER)/i, 'OpenRouter', 'llm'],
        [/(REPLICATE)/i, 'Replicate', 'llm'], [/(HUGGINGFACE|HF_TOKEN)/i, 'Hugging Face', 'llm'],
        [/(MINIMAX)/i, 'MiniMax', 'llm'], [/(BAIDU|QIANFAN|ERNIE)/i, '百度千帆', 'llm'],
        [/(VOLC|ARK|DOUBAO)/i, '火山方舟/豆包', 'llm'],
        [/(STRIPE)/i, 'Stripe', 'web'], [/(GITHUB|GH_TOKEN)/i, 'GitHub', 'web'], [/(CLOUDFLARE|CF_)/i, 'Cloudflare', 'web'],
        [/(AWS_|AMAZON)/i, 'AWS', 'web'], [/(SUPABASE)/i, 'Supabase', 'web'], [/(POSTHOG)/i, 'PostHog', 'web'],
        [/(VERCEL)/i, 'Vercel', 'web'], [/(RESEND|SENDGRID|MAILGUN)/i, '邮件服务', 'web'], [/(TWILIO)/i, 'Twilio', 'web'],
        [/(NOTION)/i, 'Notion', 'web'], [/(FEISHU|LARK)/i, '飞书/Lark', 'web'], [/(WECHAT|WX_)/i, '微信', 'web'],
        [/(ALIPAY)/i, '支付宝', 'web'], [/(TINYFISH)/i, 'TinyFish', 'web'], [/(GOOGLE)/i, 'Google', 'web']
      ];
      function guessProvider(env){ for (const it of KEY_PROVIDERS){ if (it[0].test(env)) return { name: it[1], cat: it[2] }; } return { name: '其他', cat: 'other' }; }
      function autoEnv(name){ let e = String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''); if (!e) return ''; if (!/_API_KEY$|_KEY$|_TOKEN$|_SECRET$/.test(e)) e += '_API_KEY'; return e; }
      function maskVal(v){ if (!v) return '（未填）'; if (v.length <= 8) return '••••' + String(v).slice(-2); return String(v).slice(0,3) + '••••••' + String(v).slice(-4); }
      const KEY_TEST_ENDPOINTS = {
        'OpenAI': { url: 'https://api.openai.com/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
        'Anthropic': { url: 'https://api.anthropic.com/v1/models', headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }) },
        'DeepSeek': { url: 'https://api.deepseek.com/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
        'Google Gemini': { url: (k) => 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(k), headers: () => ({}) },
        'Moonshot 月之暗面': { url: 'https://api.moonshot.cn/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
        '阿里云百炼/通义': { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
        '智谱 GLM': { url: 'https://open.bigmodel.cn/api/paas/v4/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
        'xAI Grok': { url: 'https://api.x.ai/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
        'Mistral': { url: 'https://api.mistral.ai/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
        'OpenRouter': { url: 'https://openrouter.ai/api/v1/models', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
        'Stripe': { url: 'https://api.stripe.com/v1/balance', headers: (k) => ({ Authorization: 'Bearer ' + k }) },
        'GitHub': { url: 'https://api.github.com/user', headers: (k) => ({ Authorization: 'token ' + k }) },
        'Cloudflare': { url: 'https://api.cloudflare.com/client/v4/user/tokens/verify', headers: (k) => ({ Authorization: 'Bearer ' + k }) }
      };
      async function testKey(k){
        const ep = KEY_TEST_ENDPOINTS[k.provider];
        if (!ep) { toast('暂无「' + (k.provider || k.name) + '」浏览器测试端点（或受跨域限制），可用本地桥 test 命令'); return; }
        toast('测试中：' + k.provider + ' …');
        try {
          const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
          const url = typeof ep.url === 'function' ? ep.url(k.value) : ep.url;
          const r = await fetch(url, { method: 'GET', headers: ep.headers(k.value), signal: ctrl.signal }); clearTimeout(t);
          if (r.status === 401 || r.status === 403) toast('❌ ' + k.provider + ' 鉴权失败(' + r.status + ')：Key 可能无效/过期');
          else if (r.ok) toast('✅ ' + k.provider + ' 连通正常(' + r.status + ')');
          else toast('⚠️ ' + k.provider + ' 返回 ' + r.status + '（可达，需核对权限）');
        } catch (e) { toast('测试失败：' + (e && e.message ? e.message : e) + '（多为浏览器跨域，建议用本地桥 test）'); }
      }
      function keyDueList(){ const now = new Date(); now.setHours(0,0,0,0); const out = []; (state.data.apiKeys || []).forEach((k) => { if (!k.expiresAt) return; const d = new Date(k.expiresAt + 'T00:00:00'); if (isNaN(d)) return; const dl = Math.round((d - now) / 86400000); if (dl <= 30) out.push({ k: k, dl: dl }); }); return out.sort((a, b) => a.dl - b.dl); }
      async function enableKeyReminders(){ const due = keyDueList(); if (!('Notification' in window)) { toast('当前环境不支持系统通知；' + (due.length ? ('有 ' + due.length + ' 个 Key 临期/过期') : '暂无临期')); return; } try { const p = await Notification.requestPermission(); if (p === 'granted') { toast('已开启密钥到期提醒'); if (due.length) due.slice(0,4).forEach((x) => { try { new Notification('API Key 到期提醒', { body: x.k.name + '（' + (x.k.envName || '') + '）' + (x.dl < 0 ? ('已过期 ' + (-x.dl) + ' 天') : ('剩 ' + x.dl + ' 天')) }); } catch (e) {} }); } else toast('未授权通知'); } catch (e) { toast('通知不可用'); } }
      function openKeyModal(existing){
        openModal(existing ? '编辑密钥' : '新增密钥', (body, close) => {
          const nameI = E('input', { class: 'opcv-input', props: { value: existing ? existing.name : '' } });
          const catS = E('select', { class: 'opcv-input' }); [['llm','大模型'],['web','网站 / 服务'],['other','其他']].forEach(([v,l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; catS.appendChild(o); }); catS.value = existing ? existing.category : 'llm';
          const provI = E('input', { class: 'opcv-input', props: { value: existing ? existing.provider : '' } });
          const envI = E('input', { class: 'opcv-input', props: { value: existing ? existing.envName : '' }, attrs: { placeholder: '如 OPENAI_API_KEY' } });
          const valI = E('input', { class: 'opcv-input', props: { type: 'password', value: existing ? existing.value : '' }, attrs: { placeholder: '粘贴 Key（仅本地加密保存）', autocomplete: 'off' } });
          const noteI = E('input', { class: 'opcv-input', props: { value: existing ? existing.note : '' } });
          const expI = E('input', { class: 'opcv-input', props: { type: 'date', value: existing && existing.expiresAt ? existing.expiresAt : '' } });
          const tagI = E('input', { class: 'opcv-input', props: { value: existing ? (existing.tags || '') : '' }, attrs: { placeholder: '逗号分隔，如 生产,项目A' } });
          const subjS = E('select', { class: 'opcv-input' }); { const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '（不关联主体）'; subjS.appendChild(o0); (state.data.subjects || []).forEach((s) => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.values.companyName || '未命名主体'; subjS.appendChild(o); }); subjS.value = existing && existing.subjectId ? existing.subjectId : ''; }
          const allowI = E('input', { class: 'opcv-input', props: { value: existing ? (existing.allowAgents || '') : '' }, attrs: { placeholder: '逗号分隔，如 agentA,agentB；留空=所有 Agent 可用' } });
          const lab = (t, el) => { const w = E('div', { style: 'margin-bottom:10px;' }); w.appendChild(E('div', { class: 'opcv-muted', style: 'text-align:left;margin-bottom:4px;', text: t })); w.appendChild(el); return w; };
          body.appendChild(lab('名称', nameI)); body.appendChild(lab('分类', catS)); body.appendChild(lab('服务商', provI));
          body.appendChild(lab('环境变量名（本地 Agent 调用用）', envI)); body.appendChild(lab('Key', valI)); body.appendChild(lab('备注', noteI));
          body.appendChild(lab('到期日（可选，用于轮换提醒）', expI)); body.appendChild(lab('标签（可选）', tagI)); body.appendChild(lab('关联主体（可选）', subjS)); body.appendChild(lab('授权 Agent（可选，子集权限）', allowI));
          const bar = E('div', { class: 'row', style: 'margin-top:6px;' });
          const save = E('button', { class: 'opcv-btn opcv-primary', text: '保存' });
          save.addEventListener('click', async () => {
            if (!nameI.value.trim()) { toast('请填名称'); return; }
            let env = envI.value.trim() || autoEnv(provI.value || nameI.value); envI.value = env;
            const g = guessProvider(env);
            const obj = { id: existing ? existing.id : uid('k'), name: nameI.value.trim(), category: catS.value, provider: provI.value.trim() || g.name, envName: env, value: valI.value, note: noteI.value.trim(), expiresAt: expI.value || '', tags: tagI.value.trim(), subjectId: subjS.value || '', allowAgents: allowI.value.trim(), createdAt: existing ? existing.createdAt : Date.now() };
            state.data.apiKeys = state.data.apiKeys || [];
            if (existing) { const i = state.data.apiKeys.findIndex((k) => k.id === existing.id); if (i >= 0) state.data.apiKeys[i] = obj; } else state.data.apiKeys.push(obj);
            await saveNow(); close(); renderApiKeys(); toast('已保存密钥');
          });
          const cancel = E('button', { class: 'opcv-btn', text: '取消' }); cancel.addEventListener('click', close);
          bar.appendChild(save); bar.appendChild(cancel); body.appendChild(bar);
        });
      }
      function importEnv(){
        const inp = E('input', { props: { type: 'file', accept: '.env,text/plain' }, style: 'display:none;' });
        inp.addEventListener('change', async () => {
          const f = inp.files && inp.files[0]; if (!f) return;
          try {
            const txt = await f.text(); let n = 0;
            txt.split(/\r?\n/).forEach((line) => {
              line = line.trim(); if (!line || line.startsWith('#')) return;
              const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) return;
              let val = m[2].trim().replace(/^['"]|['"]$/g, ''); if (!val) return;
              const env = m[1]; if ((state.data.apiKeys || []).some((k) => k.envName === env)) return;
              const g = guessProvider(env);
              state.data.apiKeys.push({ id: uid('k'), name: env.replace(/_/g, ' '), category: g.cat, provider: g.name, envName: env, value: val, note: '来自 .env', createdAt: Date.now() }); n++;
            });
            await saveNow(); renderApiKeys(); toast('已导入 ' + n + ' 个密钥（本地解析，未联网）');
          } catch (e) { toast('导入失败：' + (e && e.message ? e.message : e)); }
        });
        root.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 1000);
      }
      function renderApiKeys(){
        contentHost.innerHTML = '';
        const card = E('div', { class: 'opcv-card' });
        card.appendChild(E('div', { class: 'opcv-cardtitle', text: 'API 密钥 · 分类 / 一键复制 / 本地 Agent 调用' }));
        card.appendChild(E('div', { class: 'opcv-hint', text: '密钥整库加密存储、只在本机；一键复制为明文，别粘到公开处。网页/网站与大模型 Key 分开归类。' }));
        const tb = E('div', { class: 'row', style: 'margin-top:4px;' });
        const searchI = E('input', { class: 'opcv-input', props: { placeholder: '搜索名称/服务商/环境变量' }, style: 'max-width:260px;' });
        const addB = E('button', { class: 'opcv-btn opcv-primary', text: '新增密钥' }); addB.addEventListener('click', () => openKeyModal(null));
        const impB = E('button', { class: 'opcv-btn', text: '导入 .env' }); impB.addEventListener('click', importEnv);
        const envB = E('button', { class: 'opcv-btn', text: '复制为 .env' }); envB.addEventListener('click', async () => { const lines = (state.data.apiKeys || []).filter((k) => k.envName && k.value).map((k) => k.envName + '=' + k.value).join('\n'); if (!lines) { toast('还没有可导出的密钥'); return; } const ok = await copyText(lines); toast(ok ? '已复制 ' + (state.data.apiKeys.filter(k=>k.envName&&k.value).length) + ' 行到剪贴板' : '复制失败'); });
        const remindB = E('button', { class: 'opcv-btn', text: '密钥到期提醒' }); remindB.addEventListener('click', enableKeyReminders);
        tb.appendChild(searchI); tb.appendChild(addB); tb.appendChild(impB); tb.appendChild(envB); tb.appendChild(remindB); card.appendChild(tb);
        const dueN = keyDueList().length; if (dueN) card.appendChild(E('div', { class: 'opcv-hint', text: '⚠️ ' + dueN + ' 个 Key 将在 30 天内到期或已过期，建议轮换。' }));
        const searchable = [];
        const CATS = [['llm', '大模型'], ['web', '网站 / 服务'], ['other', '其他']];
        let total = 0;
        CATS.forEach(([ck, cl]) => {
          const arr = (state.data.apiKeys || []).filter((k) => k.category === ck); total += arr.length;
          if (!arr.length) return;
          card.appendChild(E('div', { class: 'opcv-cardtitle', style: 'margin-top:14px;', text: cl + '（' + arr.length + '）' }));
          arr.sort((a, b) => String(a.provider || '').localeCompare(String(b.provider || '')));
          arr.forEach((k) => {
            const row = E('div', { class: 'opcv-relrow' });
            const left = E('div', { style: 'flex:1;min-width:0;' });
            const nameLine = E('div', { class: 'opcv-relname', text: k.name });
            if (k.expiresAt) { const d = new Date(k.expiresAt + 'T00:00:00'); if (!isNaN(d)) { const now = new Date(); now.setHours(0,0,0,0); const dl = Math.round((d - now) / 86400000); nameLine.appendChild(E('span', { class: 'badge ' + (dl < 0 ? 'off' : 'on'), style: 'margin-left:8px;', text: (dl < 0 ? '已过期' : ('剩' + dl + '天')) })); } }
            left.appendChild(nameLine);
            left.appendChild(E('div', { class: 'opcv-muted', style: 'margin:2px 0 0;text-align:left;', text: (k.provider || '') + ' · ' + (k.envName || '') + (k.note ? ' · ' + k.note : '') }));
            const metaLine = E('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;' });
            String(k.tags || '').split(/[,，\s]+/).filter(Boolean).forEach((t) => metaLine.appendChild(E('span', { class: 'opcv-chip', style: 'font-size:11px;padding:1px 7px;', text: '#' + t })));
            if (k.subjectId) { const sj = getSubject(k.subjectId); if (sj) metaLine.appendChild(E('span', { class: 'opcv-chip', style: 'font-size:11px;padding:1px 7px;', text: sj.values.companyName || '主体' })); }
            if (k.allowAgents) metaLine.appendChild(E('span', { class: 'opcv-chip', style: 'font-size:11px;padding:1px 7px;', text: 'Agent: ' + k.allowAgents }));
            if (metaLine.childNodes.length) left.appendChild(metaLine);
            row.appendChild(left);
            const right = E('div', { style: 'display:flex;align-items:center;gap:8px;' });
            right.appendChild(E('span', { class: 'pc-src', text: maskVal(k.value) }));
            const cp = E('button', { class: 'opcv-btn opcv-small', text: '复制' }); cp.addEventListener('click', async () => { const ok = await copyText(k.value || ''); toast(ok ? '已复制 ' + (k.envName || k.name) : '复制失败'); });
            const ed = E('button', { class: 'opcv-btn opcv-small', text: '编辑' }); ed.addEventListener('click', () => openKeyModal(k));
            const del = E('button', { class: 'opcv-btn opcv-small', text: '删除' }); del.addEventListener('click', async () => { if (!window.confirm('删除密钥「' + k.name + '」？')) return; state.data.apiKeys = state.data.apiKeys.filter((x) => x.id !== k.id); await saveNow(); renderApiKeys(); toast('已删除'); });
            const tst = E('button', { class: 'opcv-btn opcv-small', text: '测试' }); tst.addEventListener('click', () => testKey(k));
            right.appendChild(tst); right.appendChild(cp); right.appendChild(ed); right.appendChild(del); row.appendChild(right); card.appendChild(row);
            searchable.push({ el: row, t: (k.name + ' ' + (k.provider || '') + ' ' + (k.envName || '') + ' ' + (k.note || '')).toLowerCase() });
          });
        });
        if (!total) card.appendChild(E('div', { class: 'opcv-empty', text: '还没有密钥。点「新增密钥」或「导入 .env」开始。' }));
        searchI.addEventListener('input', () => { const q = searchI.value.trim().toLowerCase(); searchable.forEach((x) => { x.el.style.display = (!q || x.t.indexOf(q) >= 0) ? '' : 'none'; }); });
        // Agent 接口
        const ac = E('div', { class: 'opcv-card', style: 'margin-top:16px;padding:12px 14px;' });
        ac.appendChild(E('div', { class: 'opcv-cardtitle', text: '本地 Agent 调用 · 预留接口（密钥不进日志/不给模型）' }));
        const firstEnv = ((state.data.apiKeys || []).find((k) => k.envName && k.value) || {}).envName || 'OPENAI_API_KEY';
        const cmdList = "OPC_VAULT_PASSWORD='<主密码>' node agent/vault-bridge.mjs list --file opc-vault-YYYYMMDD.vault.json";
        const cmdRun = "OPC_VAULT_PASSWORD='<主密码>' node agent/vault-bridge.mjs run --file opc-vault-YYYYMMDD.vault.json --key " + firstEnv + " -- <你的命令>";
        [['① 先「导出」加密备份', '点顶部「导出」得到 opc-vault-*.vault.json（整库加密，需主密码）。'],
         ['② 列出可用密钥（只显示名称/环境变量，不显示值）', cmdList],
         ['③ 把某个 Key 注入到本地命令（密钥只在子进程 env 中，不回显）', cmdRun]].forEach(([t, c]) => {
          ac.appendChild(E('div', { class: 'opcv-muted', style: 'text-align:left;margin:8px 0 3px;', text: t }));
          if (c) { const line = E('div', { class: 'opcv-mono', style: 'display:flex;align-items:center;gap:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 8px;' }); line.appendChild(E('span', { style: 'flex:1;min-width:0;word-break:break-all;font-size:12px;', text: c })); const b = E('button', { class: 'opcv-btn opcv-small', text: '复制' }); b.addEventListener('click', async () => { const ok = await copyText(c); toast(ok ? '已复制命令' : '复制失败'); }); line.appendChild(b); ac.appendChild(line); }
        });
        ac.appendChild(E('div', { class: 'disclosure', text: '安全：模型/日志不接触明文 Key；本地桥用主密码在内存解密，仅把指定 Key 注入子进程环境变量。桥文件：agent/vault-bridge.mjs。' }));
        card.appendChild(ac);
        contentHost.appendChild(card);
      }

      /* ---------- 税务（中国报税） ---------- */
      function ymd(d){ const z=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate()); }
      function adjustWeekend(d){ const w=d.getDay(); if(w===6)d.setDate(d.getDate()+2); else if(w===0)d.setDate(d.getDate()+1); return d; }
      function daysLeftOf(due){ const t=new Date(); t.setHours(0,0,0,0); const dd=new Date(due); dd.setHours(0,0,0,0); return Math.round((dd-t)/86400000); }
      function nextMonth15(now){ let y=now.getFullYear(),m=now.getMonth(); let d=new Date(y,m,15); if(now.getDate()>15) d=new Date(y,m+1,15); return adjustWeekend(d); }
      function nextQuarter15(now){ const qEnds=[2,5,8,11]; for(const qe of qEnds){ const due=new Date(now.getFullYear(),qe+1,15); if(due>=now) return adjustWeekend(due); } return adjustWeekend(new Date(now.getFullYear()+1,3,15)); }
      function annualDue(now,month0,day){ let y=now.getFullYear(); let d=new Date(y,month0,day); if(d<now) d=new Date(y+1,month0,day); return adjustWeekend(d); }
      function getTaxProfile(id){
        state.data.taxProfiles = state.data.taxProfiles || {};
        let p=state.data.taxProfiles[id];
        if(!p){ const sub=getSubject(id); p={ values:{ province:(sub&&sub.values.region)||'北京', taxpayer:'小规模', method:'查账', hasStaff:'有员工', zero:'否', industry:'' } }; state.data.taxProfiles[id]=p; }
        return p;
      }
      function buildTaxTasks(p, now){
        const v=p.values||{}; const general=/一般/.test(v.taxpayer||''); const staff=!/无|否|仅法人/.test(v.hasStaff||'有员工') && !/仅法人/.test(v.hasStaff||'');
        const q=nextQuarter15(now), m=nextMonth15(now);
        const tasks=[]; const add=(name,system,cadence,due,link,note)=>{ const dl=daysLeftOf(due); tasks.push({name,system,cadence,due:ymd(due),daysLeft:dl,status:dl<0?'overdue':dl<=7?'soon':'ok',link:link,note:note||''}); };
        const ent=regionUrl(v.province||'北京');
        const personal='https://etax.chinatax.gov.cn';
        if(staff) add('工资薪金个税（代扣代缴）','自然人电子税务局 · 扣缴端','每月',m,personal,'先做（橙线）');
        if(general) add('增值税及附加（一般纳税人·月报）','电子税务局 · 企业业务','每月',m,ent);
        else add('增值税及附加（小规模·季报）','电子税务局 · 企业业务','每季',q,ent);
        add('企业所得税（季度预缴）','电子税务局 · 企业业务','每季',q,ent);
        add('财务报表（季报）','电子税务局 · 企业业务','每季',q,ent);
        add('财产和行为税 / 印花税（合并申报）','电子税务局 · 企业业务','每季',q,ent);
        if(staff) add('社保 / 公积金申报缴纳','当地社保/公积金平台','每月',m,ent);
        add('企业所得税汇算清缴（上年度）','电子税务局 · 企业业务','每年',annualDue(now,4,31),ent);
        add('个人所得税经营所得汇算（上年度）','自然人电子税务局','每年',annualDue(now,2,31),personal);
        add('工商年报（上年度）','国家企业信用信息公示系统','每年',annualDue(now,5,30),'https://www.gsxt.gov.cn');
        tasks.sort((a,b)=>a.daysLeft-b.daysLeft);
        if(/零/.test(v.zero||'')) tasks.forEach(t=>{ t.note=(t.note?t.note+'；':'')+'零申报也需按期提交'; });
        return tasks;
      }
      function taxDueAll(){ const now=new Date(); const arr=[]; (state.data.subjects||[]).forEach(s=>{ const p=getTaxProfile(s.id); buildTaxTasks(p,now).forEach(t=>{ if(t.status!=='ok'||t.daysLeft<=15) arr.push(Object.assign({subject:s.values.companyName||'未命名主体'},t)); }); }); return arr.sort((a,b)=>a.daysLeft-b.daysLeft); }
      function renderTax(){
        contentHost.innerHTML='';
        const card=E('div',{class:'opcv-card'});
        card.appendChild(E('div',{class:'opcv-cardtitle', text:'税务 · 中国报税日历与提醒'}));
        if(!state.data.subjects.length){ card.appendChild(E('div',{class:'opcv-empty', text:'先在「公司主体」新建主体，再配置税务。'})); contentHost.appendChild(card); return; }
        let subj=getSubject(state.taxActive); if(!subj){ subj=state.data.subjects[0]; state.taxActive=subj.id; }
        const chips=E('div',{class:'opcv-chips'});
        state.data.subjects.forEach(s=>{ const b=E('span',{class:'opcv-chip', text:s.values.companyName||'未命名主体'}); b.style.cursor='pointer'; if(s.id===state.taxActive){ b.style.background='rgba(110,160,255,.22)'; b.style.color='var(--dsw-alias-brand-primary)'; } b.addEventListener('click',()=>{ state.taxActive=s.id; renderTax(); }); chips.appendChild(b); });
        card.appendChild(chips);
        const rec=getTaxProfile(subj.id);
        const pc=E('div',{class:'opcv-card', style:'margin:10px 0;padding:10px 14px;'});
        pc.appendChild(E('div',{class:'opcv-cardtitle', text:'税务档案 · '+(subj.values.companyName||'未命名主体')}));
        TAX_FIELDS.forEach(f=>pc.appendChild(fieldRow(f, rec)));
        card.appendChild(pc);
        const tasks=buildTaxTasks(rec,new Date());
        const overdue=tasks.filter(t=>t.status==='overdue').length, soon=tasks.filter(t=>t.status==='soon').length;
        card.appendChild(E('div',{class:'opcv-hint', text:'近期待办 '+tasks.length+' 项：逾期 '+overdue+' · 7天内到期 '+soon+'。'+ (/零/.test(rec.values.zero||'')?'（本期按零申报，仍需按期提交）':'')}));
        tasks.forEach(t=>{
          const row=E('div',{class:'opcv-relrow'});
          row.appendChild(E('div',{style:'flex:1;min-width:0;'}, E('div',{class:'opcv-relname', text:t.name}), E('div',{class:'opcv-muted', style:'margin:2px 0 0;text-align:left;', text:t.system+' · '+t.cadence+(t.note?' · '+t.note:'')})));
          const right=E('div',{style:'display:flex;align-items:center;gap:8px;'});
          right.appendChild(E('span',{class:'pc-src', text:'截止 '+t.due}));
          const cls=t.status==='overdue'?'off':(t.status==='soon'?'on':'on');
          right.appendChild(E('span',{class:'badge '+cls, text:(t.status==='overdue'?'逾期':'剩'+t.daysLeft+'天')}));
          const open=E('button',{class:'opcv-btn opcv-small', text:'打开'}); open.addEventListener('click',()=>{ if(t.link) window.open(t.link,'_blank','noopener'); });
          right.appendChild(open); row.appendChild(right); card.appendChild(row);
        });
        const btns=E('div',{class:'row', style:'margin-top:10px;'});
        const remind=E('button',{class:'opcv-btn', text:'开启到期提醒'}); remind.addEventListener('click', enableTaxReminders);
        const guide=E('button',{class:'opcv-btn', text:'办税向导（china-etax-wizard）'}); guide.addEventListener('click', openTaxGuide);
        const copy=E('button',{class:'opcv-btn', text:'复制本期清单'}); copy.addEventListener('click', async ()=>{ const txt=tasks.map(t=>'- '+t.name+'（'+t.system+'，截止 '+t.due+'）').join('\n'); const body='【'+(subj.values.companyName||'')+'】报税清单\n'+txt; const ok=await copyText(body); toast(ok?'已复制本期清单':'复制失败'); });
        btns.appendChild(remind); btns.appendChild(guide); btns.appendChild(copy); card.appendChild(btns);
        card.appendChild(E('div',{class:'disclosure', text:'提醒口径：月报/季报默认每月/季后 15 日（遇周末顺延；节假日以电子税务局「我的待办」为准）。本工具仅做提醒与清单，不代申报、不代提交。'}));
        contentHost.appendChild(card);
      }
      async function enableTaxReminders(){
        const due=taxDueAll();
        if(!('Notification' in window)){ toast('当前环境不支持系统通知；已在本页提示：'+(due.length?due[0].name:'暂无临近')); return; }
        try{ const p=await Notification.requestPermission(); if(p==='granted'){ toast('已开启到期提醒'); if(due.length) due.slice(0,4).forEach(t=>{ try{ new Notification('报税提醒 · '+t.subject,{ body:t.name+' · 截止 '+t.due+'（剩'+t.daysLeft+'天）' }); }catch(e){} }); } else toast('未授权系统通知'); }
        catch(e){ toast('通知不可用：'+(e&&e.message?e.message:e)); }
      }
      function openTaxGuide(){
        openModal('办税向导 · 中国电子税务局（china-etax-wizard）', (body)=>{
          body.appendChild(E('div',{class:'opcv-hint', text:'内嵌本机 skill「china-etax-wizard」的心智模型与顺序；逐点击实操请用该 skill 的浏览器模式（登录/刷脸/最终提交由本人操作）。'}));
          ['① 一个自然人一个账号：法人/财务/办税员/代账都先实名注册；登录页三页签=企业业务/自然人业务/代理业务，登录后右上角可切换身份，不用重登。',
           '② 两套系统、各自截止日、无先后：企业业务（增值税及附加、企业所得税、印花税/财产行为税、财报）+ 自然人扣缴端（工资薪金个税，每月）。',
           '③ 每期顺序：先「扣缴端工资个税」(橙线·每月) → 再「企业端各税」(蓝线·每季/年)。',
           '④ 零申报也要按期提交：无收入/无开票/无工资/无合同/无实缴由本人确认；企业所得税零申报的从业人数、资产总额系统强制>0，须据实填，不能填 0。',
           '⑤ 一次性：新办开业套餐（一照一码信息确认、财务会计制度备案、存款账户报告、票种/数电票、扣缴登记、税费种认定）只做一次。',
           '⑥ 多主体跨省：按省份分别登录对应电子税务局；同省用身份切换。',
           '⑦ 报错/时区/找不到按钮：见 skill 的 troubleshooting；最终【提交申报】、扣款、扫码/刷脸/验证码一律本人操作。'
          ].forEach(t=>body.appendChild(E('div',{class:'opcv-muted', style:'margin:6px 0;text-align:left;', text:t})));
          body.appendChild(E('div',{class:'disclosure', text:'完整清单与逐点击：skill references/ new-business-setup.md、zero-filing.md、identity-and-login.md、filing-checklist.md、troubleshooting.md。'}));
        });
      }

      /* ---------- account sets ---------- */
      function renderAccounts() {
        contentHost.innerHTML = '';
        const split = E('div', { class: 'opcv-split' });
        const listWrap = E('div');
        const lh = E('div', { class: 'opcv-listhead' });
        lh.appendChild(E('span', { style: 'font-weight:650;font-size:13px;', text: '账套' }));
        const addBtn = E('button', { class: 'opcv-btn opcv-small', html: ICON.plus + '<span>新建</span>' });
        addBtn.addEventListener('click', addAccount);
        lh.appendChild(addBtn); listWrap.appendChild(lh);
        const list = E('div', { class: 'opcv-list' });
        if (state.data.accountSets.length === 0) list.appendChild(E('div', { class: 'opcv-empty', text: '暂无账套' }));
        state.data.accountSets.forEach((a) => {
          const n = (a.subjectIds || []).length;
          const item = E('button', { class: 'opcv-listitem' + (state.activeAccount === a.id ? ' active' : '') },
            E('div', { class: 'opcv-li-name', text: a.values.name || '未命名账套' }),
            E('div', { class: 'opcv-li-meta', text: (a.values.accountingYear || '—') + ' · 关联主体 ' + n })
          );
          item.addEventListener('click', () => { state.activeAccount = a.id; renderAccounts(); });
          list.appendChild(item);
        });
        listWrap.appendChild(list);
        split.appendChild(listWrap);

        const detail = E('div', { class: 'opcv-detail' });
        let acc = getAccount(state.activeAccount);
        if (!acc && state.data.accountSets.length) { acc = state.data.accountSets[0]; state.activeAccount = acc.id; }
        if (!acc) {
          detail.appendChild(E('div', { class: 'opcv-empty', text: '请新建一个账套。' }));
        } else {
          const head = E('div', { class: 'opcv-detailhead' });
          head.appendChild(E('h3', { class: 'opcv-detailtitle', text: acc.values.name || '未命名账套' }));
          const taxBtn = E('button', { class: 'opcv-btn opcv-small', html: ICON.external + '<span>打开电子税务局</span>' });
          taxBtn.addEventListener('click', () => openTaxFor(acc));
          head.appendChild(taxBtn);
          const del = E('button', { class: 'opcv-btn opcv-small del', html: ICON.trash + '<span>删除账套</span>' });
          del.addEventListener('click', () => deleteAccount(acc.id));
          head.appendChild(del);
          detail.appendChild(head);
          detail.appendChild(linkSection(acc));
          ACCOUNT_GROUPS.forEach((g) => detail.appendChild(groupCard(acc, g)));
          detail.appendChild(customFieldsCard(acc));
        }
        split.appendChild(detail);
        contentHost.appendChild(split);
      }

      function linkSection(acc) {
        const card = E('div', { class: 'opcv-card' });
        card.appendChild(E('div', { class: 'opcv-cardtitle', text: '关联公司主体（多对多）' }));
        if (state.data.subjects.length === 0) { card.appendChild(E('div', { class: 'opcv-hint', text: '还没有公司主体，先到「公司主体」新建。' })); return card; }
        const grid = E('div', { class: 'opcv-linkgrid' });
        state.data.subjects.forEach((s) => {
          const cb = E('input', { props: { type: 'checkbox', checked: (acc.subjectIds || []).includes(s.id) } });
          const row = E('label', { class: 'opcv-linkrow' }, cb, E('span', { text: (s.values.companyName || '未命名主体') + (s.values.creditCode ? '（' + s.values.creditCode + '）' : '') }));
          cb.addEventListener('change', () => {
            if (!acc.subjectIds) acc.subjectIds = [];
            if (cb.checked) { if (!acc.subjectIds.includes(s.id)) acc.subjectIds.push(s.id); }
            else acc.subjectIds = acc.subjectIds.filter((x) => x !== s.id);
            scheduleSave();
          });
          grid.appendChild(row);
        });
        card.appendChild(grid);
        return card;
      }

      function groupCard(record, group, extraFields) {
        const card = E('div', { class: 'opcv-card' });
        card.appendChild(E('div', { class: 'opcv-cardtitle', text: group.label }));
        const fields = (group.fields || []).concat(extraFields || []);
        fields.forEach((f) => card.appendChild(fieldRow(f, record)));
        return card;
      }

      function customFieldsCard(acc) {
        const card = E('div', { class: 'opcv-card' });
        const t = E('div', { class: 'opcv-cardtitle' });
        t.appendChild(E('span', { text: '自定义字段' }));
        const add = E('button', { class: 'opcv-btn opcv-small', style: 'margin-left:auto;', html: ICON.plus + '<span>添加</span>' });
        add.addEventListener('click', openAddField);
        t.appendChild(add);
        card.appendChild(t);
        if (!state.data.customFields.length) card.appendChild(E('div', { class: 'opcv-hint', text: '为所有账套补充自定义字段（如某种平台的账号、某个证照编号）。' }));
        state.data.customFields.forEach((cf) => card.appendChild(fieldRow(cf, acc)));
        return card;
      }

      /* ---------- relations ---------- */
      function renderRelations() {
        contentHost.innerHTML = '';
        contentHost.appendChild(E('div', { class: 'opcv-hint', text: '主体 ⟷ 账套 为多对多：同一主体可拥有多个账套，一个账套也可关联多个主体。下表按两种视角列出关联关系。' }));
        const c1 = E('div', { class: 'opcv-card' });
        c1.appendChild(E('div', { class: 'opcv-cardtitle', text: '按公司主体查看其账套' }));
        if (!state.data.subjects.length) c1.appendChild(E('div', { class: 'opcv-empty', text: '暂无主体' }));
        state.data.subjects.forEach((s) => {
          const row = E('div', { class: 'opcv-relrow' });
          row.appendChild(E('div', { class: 'opcv-relname', text: s.values.companyName || '未命名主体' }));
          const chips = E('div', { class: 'opcv-chips' });
          const sets = state.data.accountSets.filter((a) => (a.subjectIds || []).includes(s.id));
          if (!sets.length) chips.appendChild(E('span', { class: 'opcv-muted', style: 'margin:0;text-align:left;', text: '无' }));
          sets.forEach((a) => chips.appendChild(E('span', { class: 'opcv-chip', text: (a.values.name || '未命名账套') })));
          row.appendChild(chips); c1.appendChild(row);
        });
        contentHost.appendChild(c1);

        const c2 = E('div', { class: 'opcv-card' });
        c2.appendChild(E('div', { class: 'opcv-cardtitle', text: '按账套查看其主体' }));
        if (!state.data.accountSets.length) c2.appendChild(E('div', { class: 'opcv-empty', text: '暂无账套' }));
        state.data.accountSets.forEach((a) => {
          const row = E('div', { class: 'opcv-relrow' });
          row.appendChild(E('div', { class: 'opcv-relname', text: a.values.name || '未命名账套' }));
          const chips = E('div', { class: 'opcv-chips' });
          const subs = (a.subjectIds || []).map(getSubject).filter(Boolean);
          if (!subs.length) chips.appendChild(E('span', { class: 'opcv-muted', style: 'margin:0;text-align:left;', text: '未关联主体' }));
          subs.forEach((s) => chips.appendChild(E('span', { class: 'opcv-chip', text: (s.values.companyName || '未命名主体') })));
          row.appendChild(chips); c2.appendChild(row);
        });
        contentHost.appendChild(c2);
      }

      /* ---------- field row ---------- */
      function fieldRow(f, record) {
        const row = E('div', { class: 'opcv-field' });
        const label = E('div', { class: 'opcv-flabel' });
        label.appendChild(E('span', { text: f.label }));
        if (f.type === 'secret') label.appendChild(E('span', { class: 'opcv-badge', text: '密' }));
        if (f.mono) label.appendChild(E('span', { class: 'opcv-badge opcv-badge-mono', text: '#' }));
        row.appendChild(label);
        const vwrap = E('div', { class: 'opcv-fval' });
        if (f.type === 'image') { vwrap.appendChild(imageField(f, record)); }
        else if (f.type === 'textarea') {
          const inrow = E('div', { class: 'opcv-inrow' });
          const ta = E('textarea', { class: 'opcv-input opcv-textarea', props: { rows: 2, placeholder: f.placeholder || '' } });
          ta.value = String(record.values[f.key] || '');
          ta.addEventListener('input', () => { record.values[f.key] = ta.value; scheduleSave(); });
          inrow.appendChild(ta); inrow.appendChild(fieldActions(f, () => ta.value)); vwrap.appendChild(inrow);
        } else {
          const inrow = E('div', { class: 'opcv-inrow' });
          const inp = E('input', { class: 'opcv-input' + (f.mono ? ' opcv-mono' : ''), props: { type: f.type === 'secret' ? 'password' : (f.type === 'date' ? 'date' : 'text'), placeholder: f.placeholder || '' } });
          inp.value = String(record.values[f.key] || '');
          inp.addEventListener('input', () => { record.values[f.key] = inp.value; scheduleSave(); });
          inrow.appendChild(inp);
          if (f.type === 'secret') { const eye = E('button', { class: 'opcv-iconbtn', html: ICON.eye, attrs: { title: '显示 / 隐藏' } }); eye.addEventListener('click', () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; eye.innerHTML = show ? ICON.eyeOff : ICON.eye; }); inrow.appendChild(eye); }
          if (f.type === 'url') { const op = E('button', { class: 'opcv-iconbtn', html: ICON.external, attrs: { title: '打开链接' } }); op.addEventListener('click', () => { const u = inp.value.trim(); if (u) window.open(/^https?:\/\//.test(u) ? u : 'https://' + u, '_blank', 'noopener'); }); inrow.appendChild(op); }
          inrow.appendChild(fieldActions(f, () => inp.value)); vwrap.appendChild(inrow);
        }
        row.appendChild(vwrap);
        return row;
      }

      function fieldActions(f, getVal) {
        const box = E('div', { class: 'opcv-fieldactions' });
        const cp = E('button', { class: 'opcv-iconbtn', html: ICON.copy, attrs: { title: '复制' } });
        cp.addEventListener('click', async () => { const v = String(getVal() || ''); if (!v) { toast('为空，无内容可复制'); return; } const ok = await copyText(v); toast(ok ? '已复制到剪贴板' : '复制失败（浏览器限制）'); });
        box.appendChild(cp);
        return box;
      }

      function imageField(f, record) {
        const val = String(record.values[f.key] || '');
        const row = E('div', { class: 'opcv-imgrow' });
        const zone = E('div', { class: 'opcv-imgzone' + (state.armedImage && state.armedImage.key === f.key && state.armedImage.record === record ? ' armed' : ''), attrs: { tabindex: '0' } });
        if (val) { const img = E('img', { class: 'opcv-thumb', props: { src: val, alt: f.label } }); img.addEventListener('click', (e) => { e.stopPropagation(); viewImage(val, f.label); }); zone.appendChild(img); }
        else zone.appendChild(E('div', { class: 'opcv-imgempty', text: '点击选择 · 拖入 · 聚焦后 Ctrl/⌘+V 粘贴' }));
        const file = E('input', { props: { type: 'file', accept: 'image/*' }, style: 'display:none;' });
        file.addEventListener('change', () => { if (file.files && file.files[0]) readImageFile(file.files[0], record, f.key); });
        zone.addEventListener('click', () => { state.armedImage = { record, key: f.key }; if (!record.values[f.key]) file.click(); });
        zone.addEventListener('focus', () => { state.armedImage = { record, key: f.key }; });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('armed'); });
        zone.addEventListener('dragleave', () => { zone.classList.remove('armed'); });
        zone.addEventListener('drop', (e) => { e.preventDefault(); state.armedImage = { record, key: f.key }; const fl = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (fl) readImageFile(fl, record, f.key); });
        row.appendChild(zone); row.appendChild(file);
        const btns = E('div', { class: 'opcv-imgbtns' });
        const up = E('button', { class: 'opcv-btn opcv-small', html: ICON.upload + '<span>上传</span>' }); up.addEventListener('click', () => { state.armedImage = { record, key: f.key }; file.click(); }); btns.appendChild(up);
        const pst = E('button', { class: 'opcv-btn opcv-small', html: ICON.copy + '<span>粘贴</span>' }); pst.addEventListener('click', () => { state.armedImage = { record, key: f.key }; zone.classList.add('armed'); toast('已选中，按 Ctrl/⌘+V 粘贴图片'); zone.focus(); }); btns.appendChild(pst);
        if (val) {
          if (f.ocr) { const sc = E('button', { class: 'opcv-btn opcv-small', html: ICON.scan + '<span>识别</span>' }); sc.addEventListener('click', () => runOCR(f, record, val)); btns.appendChild(sc); }
          const cp = E('button', { class: 'opcv-btn opcv-small', html: ICON.copy + '<span>复制图</span>' }); cp.addEventListener('click', () => copyImage(val)); btns.appendChild(cp);
          const dl = E('button', { class: 'opcv-btn opcv-small', html: ICON.trash + '<span>删除</span>' }); dl.addEventListener('click', () => { delete record.values[f.key]; scheduleSave(); renderApp(); toast('已删除图片'); }); btns.appendChild(dl);
        }
        row.appendChild(btns);
        return row;
      }

      function readImageFile(file, record, key) {
        if (!file.type || file.type.indexOf('image/') !== 0) { toast('请选择图片文件'); return; }
        if (file.size > 8 * 1024 * 1024) { toast('图片过大（上限 8MB）'); return; }
        const reader = new FileReader();
        reader.onload = () => { record.values[key] = String(reader.result || ''); scheduleSave(); toast('图片已保存到本机加密库'); renderApp(); };
        reader.onerror = () => toast('读取图片失败');
        reader.readAsDataURL(file);
      }

      function viewImage(src, label) {
        openModal(label || '查看图片', (body) => {
          body.appendChild(E('img', { class: 'opcv-viewimg', props: { src, alt: label || '' } }));
          const bar = E('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px;' });
          const cp = E('button', { class: 'opcv-btn opcv-small', html: ICON.copy + '<span>复制图片</span>' }); cp.addEventListener('click', () => copyImage(src));
          const dl = E('button', { class: 'opcv-btn opcv-small', html: ICON.download + '<span>下载</span>' }); dl.addEventListener('click', () => { const a = document.createElement('a'); a.href = src; a.download = (label || 'image') + '.png'; a.click(); });
          bar.appendChild(cp); bar.appendChild(dl); body.appendChild(bar);
        });
      }
      async function copyImage(dataUrl) {
        try { const resp = await fetch(dataUrl); const blob = await resp.blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); toast('图片已复制到剪贴板'); }
        catch (e) { toast('复制图片失败（浏览器限制）'); }
      }

      async function runOCR(f, record, dataUrl) {
        openModal('识别图片内容', (body) => {
          body.appendChild(E('div', { class: 'opcv-hint', id: 'opcv-ocr-status', text: '正在加载 OCR 引擎…（首次需联网下载识别模型）' }));
          body.appendChild(E('div', { class: 'opcv-pre', id: 'opcv-ocr-text', text: '' }));
        });
        const statusEl = document.getElementById('opcv-ocr-status'); const textEl = document.getElementById('opcv-ocr-text');
        try {
          const text = await ocrImage(dataUrl, (m) => { if (statusEl) statusEl.textContent = '识别中… ' + (m.status || '') + (m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : ''); });
          if (statusEl) statusEl.textContent = '识别完成：'; if (textEl) textEl.textContent = text || '（未识别到文字）';
          const parsed = f.ocr === 'license' ? extractLicenseFields(text) : parseOCR(text);
          if (f.ocr === 'license') { try { const recs = await aiImport(text); if (recs && recs.length) Object.assign(parsed, recs[0].subj || {}, recs[0].acc || {}); } catch (e) {} }
          const targets = f.ocr === 'idcard' ? ['legalRepName'] : (f.ocr === 'license' ? ['companyName', 'creditCode', 'legalRepName', 'registeredCapital', 'establishDate', 'companyType', 'registeredAddress', 'businessScope', 'registrationAuthority'] : ['companyName', 'creditCode', 'legalRepName', 'registeredCapital', 'establishDate']);
          let filled = 0;
          targets.forEach((k) => { if (parsed[k] && !String(record.values[k] || '').trim()) { record.values[k] = parsed[k]; filled++; } });
          if (filled > 0) { scheduleSave(); renderApp(); toast('已识别并填入 ' + filled + ' 个字段'); }
          else if (Object.keys(parsed).length > 0) toast('识别到内容，但对应字段已有值（未覆盖）');
          else toast('未识别到可自动填入的字段');
        } catch (e) { if (statusEl) statusEl.textContent = '识别失败：' + (e && e.message ? e.message : e); }
      }

      /* ---------- CRUD ---------- */
      function addSubject() { const s = { id: uid('s'), values: {} }; state.data.subjects.push(s); state.activeSubject = s.id; scheduleSave(); renderApp(); toast('已新建公司主体'); }
      function deleteSubject(id) { if (!window.confirm('删除该主体？其与账套的关联也会一并解除（不影响账套本身）。')) return; state.data.subjects = state.data.subjects.filter((s) => s.id !== id); state.data.accountSets.forEach((a) => { if (a.subjectIds) a.subjectIds = a.subjectIds.filter((x) => x !== id); }); if (state.activeSubject === id) state.activeSubject = state.data.subjects[0] ? state.data.subjects[0].id : null; scheduleSave(); renderApp(); toast('已删除主体'); }
      function addAccount() {
        const subj = state.activeSubject ? getSubject(state.activeSubject) : null;
        const base = subj && subj.values.companyName ? subj.values.companyName : '新公司';
        const a = { id: uid('a'), values: { name: base + '·账套' + new Date().getFullYear() }, subjectIds: state.activeSubject ? [state.activeSubject] : [] };
        state.data.accountSets.push(a); state.activeAccount = a.id; scheduleSave(); renderApp(); toast('已新建账套');
      }
      function deleteAccount(id) { if (!window.confirm('删除该账套？')) return; state.data.accountSets = state.data.accountSets.filter((a) => a.id !== id); if (state.activeAccount === id) state.activeAccount = state.data.accountSets[0] ? state.data.accountSets[0].id : null; scheduleSave(); renderApp(); toast('已删除账套'); }

      function openAddField() {
        openModal('添加自定义字段（作用于所有账套）', (body, close) => {
          const label = E('input', { class: 'opcv-input', props: { type: 'text', placeholder: '字段名称，如「商标注册号」' } });
          const typeSel = E('select', { class: 'opcv-input' });
          [['text', '单行文本'], ['textarea', '多行文本'], ['secret', '密码 / 敏感'], ['date', '日期'], ['image', '图片']].forEach(([v, t]) => typeSel.appendChild(E('option', { text: t, attrs: { value: v } })));
          const err = E('div', { class: 'opcv-err' });
          const ok = E('button', { class: 'opcv-btn opcv-primary', style: 'width:100%;height:36px;justify-content:center;', text: '添加' });
          ok.addEventListener('click', () => {
            const name = label.value.trim(); if (!name) { err.textContent = '请输入字段名称'; return; }
            state.data.customFields.push({ key: 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label: name, type: typeSel.value });
            scheduleSave(); close(); renderAccounts(); toast('已添加字段');
          });
          body.appendChild(label); body.appendChild(typeSel); body.appendChild(err); body.appendChild(ok); setTimeout(() => label.focus(), 30);
        });
      }

      /* ---------- modal ---------- */
      function openModal(title, build) {
        const overlay = E('div', { class: 'opcv-overlay' });
        const modal = E('div', { class: 'opcv-modal' });
        const head = E('div', { class: 'opcv-modalhead' });
        head.appendChild(E('h3', { class: 'opcv-modalTitle', text: title }));
        const x = E('button', { class: 'opcv-iconbtn', html: ICON.close }); head.appendChild(x);
        const body = E('div', { class: 'opcv-modalbody' });
        modal.appendChild(head); modal.appendChild(body); overlay.appendChild(modal); root.appendChild(overlay);
        const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
        const esc = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', esc); x.addEventListener('click', close); overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        build(body, close); return close;
      }

      /* ---------- OPC 生态（渐进引流，不打扰） ---------- */
      function openEcosystem() {
        openModal('OPC 生态 · 从个人金库到一人公司操作系统', (body) => {
          const item = (title, desc, btnText, onClick, primary) => {
            const row = E('div', { class: 'opcv-relrow' });
            row.appendChild(E('div', { style: 'flex:1;min-width:0;' },
              E('div', { class: 'opcv-relname', text: title }),
              E('div', { class: 'opcv-muted', style: 'margin:4px 0 0;text-align:left;', text: desc })));
            const b = E('button', { class: 'opcv-btn' + (primary ? ' opcv-primary' : ''), text: btnText });
            b.addEventListener('click', onClick); row.appendChild(b); return row;
          };
          body.appendChild(E('div', { class: 'opcv-hint', text: 'OPC Vault 先把「资料安全、好用」做透；当你想把资产、财务、订阅、文档与自动化接进来时，再平滑升级到 OPC Business OS / Agent。' }));
          body.appendChild(item('OPC Vault（当前）', '本地优先、端到端加密的公司主体与账套金库。', '已在用', () => {}, false));
          body.appendChild(item('OPC Business OS · 内测预约', '一人公司操作系统：资产台账、财务账本、订阅、合同、经营分析、插件市场一体化。', '了解并预约', () => { try { window.open(OPC_ECOSYSTEM.businessOs, '_blank', 'noopener'); } catch (e) {} }, true));
          body.appendChild(item('OPC 创业资源导航', 'boyue.ai：公司注册、财税、银行、云与 SaaS、出海等真实站点，同心圆分类。', '打开导航', () => { try { window.open(OPC_ECOSYSTEM.nav, '_blank', 'noopener'); } catch (e) {} }, false));
          body.appendChild(E('div', { class: 'opcv-muted', style: 'margin:14px 0 0;text-align:center;', text: '由 ' + OPC_ECOSYSTEM.brand + ' 出品' }));
        });
      }

      /* ---------- change pwd / passkey ---------- */
      function openChangePassword() {
        openModal('修改主密码', (body, close) => {
          body.appendChild(E('div', { class: 'opcv-hint', text: '修改主密码只更换解锁钥匙，不会重新加密全部资料。旧密码将立即失效。' }));
          const cur = E('input', { class: 'opcv-input', props: { type: 'password', placeholder: '当前主密码' } });
          const nw = E('input', { class: 'opcv-input', props: { type: 'password', placeholder: '新主密码（至少 8 位）' } });
          const nw2 = E('input', { class: 'opcv-input', props: { type: 'password', placeholder: '确认新主密码' } });
          const err = E('div', { class: 'opcv-err' });
          const ok = E('button', { class: 'opcv-btn opcv-primary', style: 'width:100%;height:36px;justify-content:center;', text: '确认修改' });
          ok.addEventListener('click', async () => {
            err.textContent = ''; if (nw.value.length < 8) { err.textContent = '新主密码至少 8 位'; return; } if (nw.value !== nw2.value) { err.textContent = '两次输入的新密码不一致'; return; }
            ok.disabled = true; ok.textContent = '处理中…';
            try {
              const curKek = await deriveKEK(cur.value, b64ToBuf(state.meta.saltB64));
              try { await unwrapDEK(state.meta.wrappedDEK.iv, state.meta.wrappedDEK.wrapped, curKek); } catch (e) { err.textContent = '当前主密码错误'; ok.disabled = false; ok.textContent = '确认修改'; return; }
              const newSalt = randomBytes(SALT_BYTES); const newKek = await deriveKEK(nw.value, newSalt); const reWrapped = await wrapDEK(state.dek, newKek);
              state.meta.saltB64 = bufToB64(newSalt); state.meta.wrappedDEK = reWrapped; await idbSet('meta', state.meta); await saveNow();
              close(); toast('主密码已修改');
            } catch (e) { err.textContent = '修改失败：' + (e && e.message ? e.message : e); ok.disabled = false; ok.textContent = '确认修改'; }
          });
          body.appendChild(cur); body.appendChild(nw); body.appendChild(nw2); body.appendChild(err); body.appendChild(ok);
        });
      }
      async function registerPasskey(dek) {
        if (!window.PublicKeyCredential || !navigator.credentials) return { ok: false, reason: 'UNSUPPORTED' };
        { const env = passkeyEnv(); if (!env.ok) return { ok: false, reason: env.reason }; }
        const rpId = location.hostname; const prfSalt = randomBytes(32); let cred;
        try { cred = await navigator.credentials.create({ publicKey: { challenge: randomBytes(32), rp: { id: rpId, name: 'OPC Vault' }, user: { id: randomBytes(16), name: 'opc-vault', displayName: 'OPC Vault' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' }, timeout: 60000, extensions: { prf: { eval: { first: prfSalt } } } } }); }
        catch (e) { throw new Error('Passkey 注册被取消或不支持：' + (e && e.message ? e.message : e)); }
        const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
        const prf = ext && ext.prf && ext.prf.results && ext.prf.results.first;
        if (!prf) return { ok: false, reason: 'PRF_NOT_SUPPORTED' };
        const kek = await deriveKEKFromPrf(new Uint8Array(prf), prfSalt); const wrapped = await wrapDEK(dek, kek);
        return { ok: true, record: { credentialIdB64: bufToB64(cred.rawId), prfSaltB64: bufToB64(prfSalt), wrapped } };
      }
      async function unlockWithPasskey() {
        const pk = state.meta.passkey; const prfSalt = b64ToBuf(pk.prfSaltB64);
        const assertion = await navigator.credentials.get({ publicKey: { challenge: randomBytes(32), allowCredentials: [{ type: 'public-key', id: b64ToBuf(pk.credentialIdB64) }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: prfSalt } } } } });
        const ext = assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {};
        const prf = ext && ext.prf && ext.prf.results && ext.prf.results.first;
        if (!prf) throw new Error('该设备/本次验证未返回 PRF 密钥');
        const kek = await deriveKEKFromPrf(new Uint8Array(prf), prfSalt);
        return unwrapDEK(pk.wrapped.iv, pk.wrapped.wrapped, kek);
      }
      function showPasskeyHelp() {
        const env = passkeyEnv();
        openModal('为什么无法启用 Passkey？', (body) => {
          if (!env.ok) body.appendChild(E('div', { class: 'opcv-hint', style: 'color:var(--dsw-alias-state-warn-primary);', text: '当前问题：' + env.msg }));
          const html = '<b>Passkey（WebAuthn）的硬性要求：</b>'
            + '<ol style="margin:8px 0 0 18px;padding:0;line-height:1.75;">'
            + '<li><b>地址必须是 HTTPS 或 http://localhost，不能是 IP。</b> 你现在是 <code>' + location.origin + '</code>。把地址栏里的 <code>127.0.0.1</code> 改成 <b>localhost</b>（端口与 token 不变）再打开即可。</li>'
            + '<li><b>浏览器要支持 WebAuthn PRF 扩展</b>（插件用它从 Passkey 派生加密密钥）。<b>macOS 的 Safari 对 PRF 支持不稳定、通常不可用</b>；请用<b>最新版 Chrome 或 Edge</b>。</li>'
            + '<li><b>需要平台验证器</b>：macOS 的 Touch ID / Face ID，或外接安全密钥，并在系统中启用。</li>'
            + '<li>若在 <b>DeepSeek Harness 桌面内嵌窗口</b>中，WebAuthn 可能被内嵌环境禁用 —— 请改用 Chrome/Edge 打开同一地址。</li>'
            + '</ol>'
            + '<p style="margin:10px 0 0;"><b>macOS 推荐做法：</b>用 Chrome 打开 <code>http://localhost:' + (location.port || '64389') + '</code> → 进入 OPC Vault → 点「启用 Passkey」→ Touch ID 验证。</p>'
            + '<p style="margin:8px 0 0;color:var(--dsw-alias-label-secondary);">主密码解锁始终可用，不受影响。</p>';
          body.appendChild(E('div', { class: 'opcv-hint', html }));
        });
      }

      async function enablePasskey() {
        const env = passkeyEnv();
        if (!env.ok) { toast(env.msg); return; }
        try {
          toast('正在创建 Passkey…');
          const pk = await registerPasskey(state.dek);
          if (!pk.ok) {
            if (pk.reason === 'PRF_NOT_SUPPORTED') toast('该浏览器不支持 WebAuthn PRF：macOS 的 Safari 通常不支持，请改用最新版 Chrome 或 Edge，或继续用主密码');
            else if (pk.reason === 'ORIGIN_IP' || pk.reason === 'INSECURE' || pk.reason === 'NO_WEBAUTHN') toast(passkeyHint());
            else toast('Passkey 不可用');
            return;
          }
          state.meta.passkey = pk.record; await idbSet('meta', state.meta); renderApp(); toast('已启用 Passkey 快捷解锁');
        } catch (e) { toast('启用失败：' + (e && e.message ? e.message : e)); }
      }

      function openTaxFor(acc) {
        let url = String(acc.values.taxBureauUrl || '').trim();
        if (!url && acc.values.region) url = regionUrl(acc.values.region);
        if (!url) url = REGIONS[0].url;
        if (!/^https?:\/\//.test(url)) url = 'https://' + url;
        window.open(url, '_blank', 'noopener');
      }

      /* ---------- smart bulk import ---------- */
      function openLicenseImport() {
        openModal('营业执照识别（电子营业执照 / 实拍照片）', (body, close) => {
          body.appendChild(E('div', { class: 'opcv-hint', html: '上传或粘贴<b>营业执照图片</b>：电子营业执照截图、或执照实拍照片均可。图片正面、清晰、无遮挡时识别最准。识别后用<b>本地模型/规则</b>抽取工商信息，确认后自动创建公司主体（并把执照图存入「证照与印章」）。' }));
          const zone = E('div', { class: 'opcv-imgzone', attrs: { tabindex: '0' }, style: 'min-height:150px;' });
          zone.appendChild(E('div', { class: 'opcv-imgempty', text: '点击选择图片 · 拖入 · 聚焦后 Ctrl/⌘+V 粘贴' }));
          const file = E('input', { props: { type: 'file', accept: 'image/*' }, style: 'display:none;' });
          const status = E('div', { class: 'opcv-hint', text: '' });
          const preview = E('div', { class: 'opcv-pre', style: 'margin-top:10px;display:none;' });
          const bar = E('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;' });
          const runBtn = E('button', { class: 'opcv-btn opcv-primary', text: '识别并创建主体' });
          const pickBtn = E('button', { class: 'opcv-btn opcv-small', text: '重新选择' });
          let dataUrl = null;
          function setImage(url) { dataUrl = url; zone.innerHTML = ''; zone.appendChild(E('img', { class: 'opcv-thumb', props: { src: url, alt: '营业执照' }, style: 'max-height:200px;' })); status.textContent = '图片已就绪，点「识别并创建主体」。'; }
          function pick(f) { if (!f) return; if (!f.type || f.type.indexOf('image/') !== 0) { toast('请选择图片文件'); return; } if (f.size > 10 * 1024 * 1024) { toast('图片过大（上限 10MB）'); return; } const r = new FileReader(); r.onload = () => setImage(String(r.result || '')); r.onerror = () => toast('读取图片失败'); r.readAsDataURL(f); }
          file.addEventListener('change', () => { if (file.files && file.files[0]) pick(file.files[0]); });
          zone.addEventListener('click', () => file.click());
          zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('armed'); });
          zone.addEventListener('dragleave', () => zone.classList.remove('armed'));
          zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('armed'); const fl = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (fl) pick(fl); });
          function onPaste(e) { const items = (e.clipboardData && e.clipboardData.items) || []; for (const it of items) { if (it.type && it.type.indexOf('image/') === 0) { const fl = it.getAsFile(); if (fl) { pick(fl); e.preventDefault(); return; } } } }
          body.addEventListener('paste', onPaste);
          pickBtn.addEventListener('click', () => { dataUrl = null; zone.innerHTML = ''; zone.appendChild(E('div', { class: 'opcv-imgempty', text: '点击选择图片 · 拖入 · 聚焦后 Ctrl/⌘+V 粘贴' })); preview.style.display = 'none'; status.textContent = ''; file.click(); });
          runBtn.addEventListener('click', async () => {
            if (!dataUrl) { toast('请先选择营业执照图片'); return; }
            runBtn.disabled = true; const old = runBtn.textContent; runBtn.textContent = '识别中…';
            status.textContent = '正在 OCR 识别文字…（首次需下载中文识别模型，请稍候）';
            try {
              const text = await ocrImage(dataUrl, (m) => { status.textContent = 'OCR 识别中… ' + (m.status || '') + (m.progress != null ? ' ' + Math.round(m.progress * 100) + '%' : ''); });
              status.textContent = '文字已提取，正在结构化…';
              let fields = extractLicenseFields(text);
              try { const recs = await aiImport(text); if (recs && recs.length) fields = Object.assign({}, fields, recs[0].subj || {}, recs[0].acc || {}); } catch (e) { /* 离线：仅规则 */ }
              const labelMap = { companyName: '公司名称', creditCode: '统一社会信用代码', legalRepName: '法定代表人', registeredCapital: '注册资本', establishDate: '成立日期', companyType: '公司类型', registeredAddress: '注册地址', businessScope: '经营范围', registrationAuthority: '登记机关', legalRepPhone: '法人手机' };
              const keys = Object.keys(labelMap).filter((k) => fields[k] && String(fields[k]).trim());
              if (!keys.length) { preview.style.display = 'block'; preview.textContent = '未识别到工商字段。以下是 OCR 原文，可复制后到「批量导入」手动整理：\n\n' + (text || '（空）'); status.textContent = '未抽取到字段'; return; }
              preview.style.display = 'block';
              preview.textContent = '识别结果（创建后仍可修改）：\n' + keys.map((k) => '· ' + labelMap[k] + '：' + String(fields[k]).slice(0, 120)).join('\n') + '\n\n— OCR 原文（节选）—\n' + String(text || '').slice(0, 700);
              if (!window.confirm('识别到公司：' + (fields.companyName || '（未命名）') + (fields.creditCode ? '｜' + fields.creditCode : '') + '\n将创建 1 个公司主体和 1 个账套，并把执照图存入该主体。确认创建？')) return;
              const s = { id: uid('s'), values: Object.assign({}, fields) };
              if (!s.values.companyName) s.values.companyName = '未命名主体';
              s.values.businessLicenseImage = dataUrl;
              const a = { id: uid('a'), values: { name: s.values.companyName + '·账套' + new Date().getFullYear() }, subjectIds: [s.id] };
              state.data.subjects.push(s); state.data.accountSets.push(a);
              scheduleSave(); close();
              state.view = 'subjects'; state.activeSubject = s.id;
              renderApp(); toast('已创建 1 个公司主体与 1 个账套（含执照图）');
            } catch (e) {
              status.textContent = '识别失败：' + (e && e.message ? e.message : e);
            } finally { runBtn.disabled = false; runBtn.textContent = old; }
          });
          bar.appendChild(runBtn); bar.appendChild(pickBtn);
          body.appendChild(zone); body.appendChild(file); body.appendChild(bar); body.appendChild(status); body.appendChild(preview);
          setTimeout(() => zone.focus(), 30);
        });
      }
      function openBulkImport() {
        openModal('批量粘贴导入（AI / 自动识别多主体 · 多账套）', (body, close) => {
          body.appendChild(E('div', { class: 'opcv-hint', html: '把资料一次性粘贴进来（支持<b>杂乱无标签的整段文字</b>、Excel 表格、或 JSON）。<b>「AI 识别」</b>用本机本地模型理解内容，最稳；<b>「规则识别」</b>离线可用、不联网。识别后自动创建主体与账套并自动关联。' }));
          const ta = E('textarea', { class: 'opcv-input opcv-textarea', style: 'min-height:180px;', props: { rows: 10, placeholder: '可直接粘贴一段乱文，例如：\n上海示例科技有限公司，统一社会信用代码91310115MA1K000000，法定代表人张三，电话13800000000。开户行工商银行上海分行，账号6222000011112222。深圳市测试贸易有限公司，统一社会信用代码91440300MA5ABCDE12，法定代表人李四，一般户开户行招商银行深圳分行，账号755900001111。\n（也支持「字段：值」多行 / Excel 表格 / JSON）' } });
          const preview = E('div', { class: 'opcv-pre', style: 'margin-top:10px;display:none;' });
          const bar = E('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;' });
          const aiBtn = E('button', { class: 'opcv-btn opcv-primary', text: 'AI 识别并创建（本地模型）' });
          const ruleBtn = E('button', { class: 'opcv-btn', text: '规则识别并创建' });
          const previewBtn = E('button', { class: 'opcv-btn opcv-small', text: '识别预览' });
          function doCreate(recs, srcLabel) {
            if (!recs || !recs.length) { toast('未识别到任何资料'); return; }
            if (!window.confirm('识别到 ' + recs.length + ' 条资料，将创建 ' + recs.length + ' 个公司主体和 ' + recs.length + ' 个账套并自动关联。确认创建？')) return;
            recs.forEach((r) => {
              const s = { id: uid('s'), values: Object.assign({}, r.subj) };
              if (!s.values.companyName) s.values.companyName = '未命名主体';
              const a = { id: uid('a'), values: Object.assign({ name: s.values.companyName + '·账套' + new Date().getFullYear() }, r.acc), subjectIds: [s.id] };
              if (!a.values.taxBureauUrl && a.values.region) a.values.taxBureauUrl = regionUrl(a.values.region);
              state.data.subjects.push(s); state.data.accountSets.push(a);
            });
            scheduleSave(); close();
            state.view = 'subjects'; state.activeSubject = state.data.subjects[state.data.subjects.length - 1].id;
            renderApp(); toast((srcLabel ? srcLabel + ' · ' : '') + '已创建 ' + recs.length + ' 个公司主体与 ' + recs.length + ' 个账套');
          }
          previewBtn.addEventListener('click', () => {
            const recs = parseImport(ta.value); preview.style.display = 'block';
            if (!recs.length) { preview.textContent = '未识别到任何资料，请检查内容或格式。'; return; }
            preview.textContent = '规则识别到 ' + recs.length + ' 条：\n' + recs.map((r, i) => (i + 1) + '. ' + (r.subj.companyName || '（未命名主体）') + (r.subj.creditCode ? '｜' + r.subj.creditCode : '') + ' ｜ 主体字段 ' + Object.keys(r.subj).length + ' / 账套字段 ' + Object.keys(r.acc).length).join('\n');
          });
          ruleBtn.addEventListener('click', () => doCreate(parseImport(ta.value), '规则'));
          aiBtn.addEventListener('click', async () => {
            const text = ta.value;
            if (!text.trim()) { toast('请先粘贴内容'); return; }
            aiBtn.disabled = true; const old = aiBtn.textContent; aiBtn.textContent = '本地模型识别中…';
            try {
              const recs = await aiImport(text);
              if (recs && recs.length) { doCreate(recs, 'AI'); }
              else { const fb = parseImport(text); if (fb.length) { toast('本地模型无结果，已回退规则识别'); doCreate(fb, '规则'); } else toast('AI 与规则均未识别到资料'); }
            } catch (e) {
              const fb = parseImport(text);
              if (fb.length) { toast('本地模型不可用，已回退规则识别'); doCreate(fb, '规则'); }
              else toast('AI 识别失败：' + (e && e.message ? e.message : e));
            } finally { aiBtn.disabled = false; aiBtn.textContent = old; }
          });
          bar.appendChild(aiBtn); bar.appendChild(ruleBtn); bar.appendChild(previewBtn);
          body.appendChild(ta); body.appendChild(bar); body.appendChild(preview);
          setTimeout(() => ta.focus(), 30);
        });
      }
      async function aiImport(text) {
        const res = await fetch('/plugins/opc-vault/recognize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
        if (!res.ok) throw new Error('host route HTTP ' + res.status);
        const data = await res.json();
        if (!data || !data.ok || typeof data.raw !== 'string') throw new Error(data && data.error ? data.error : 'no model output');
        let raw = String(data.raw).trim();
        const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) raw = fence[1].trim();
        const s = raw.indexOf('['), o = raw.indexOf('{');
        let start = -1; if (s >= 0 && (o < 0 || s < o)) start = s; else if (o >= 0) start = o;
        if (start > 0) raw = raw.slice(start);
        return parseStructured(raw) || [];
      }

      /* ---------- export / import ---------- */
      async function exportVault() {
        try {
          await saveNow(); const payload = await idbGet('vault');
          const bundle = { app: 'opc-vault', version: 2, exportedAt: new Date().toISOString(), meta: state.meta, vault: payload };
          const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; const d = new Date(); a.download = 'opc-vault-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.vault.json'; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 3000); toast('已导出加密备份（需原主密码才能恢复）');
        } catch (e) { toast('导出失败：' + (e && e.message ? e.message : e)); }
      }
      function importVault() {
        const input = E('input', { props: { type: 'file', accept: '.json,application/json' }, style: 'display:none;' });
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0]; if (!file) return;
          try {
            const txt = await file.text(); const data = JSON.parse(txt);
            if (!data || data.app !== 'opc-vault' || !data.meta || !data.meta.saltB64 || !data.meta.wrappedDEK || !data.vault) throw new Error('不是有效的 OPC Vault 备份文件');
            if (!window.confirm('导入将覆盖当前本机账套库，且需要该备份的主密码才能解锁。确定继续？')) return;
            await idbSet('meta', data.meta); await idbSet('vault', data.vault);
            state.meta = data.meta; state.dek = null; state.data = null; state.mode = 'unlock'; render(); toast('已导入备份，请用该备份的主密码解锁');
          } catch (e) { toast('导入失败：' + (e && e.message ? e.message : e)); }
        });
        root.appendChild(input); input.click(); setTimeout(() => input.remove(), 1000);
      }

      /* ---------- copy ---------- */
      async function copyText(t) {
        try { await navigator.clipboard.writeText(t); return true; }
        catch (e) { try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; root.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e2) { return false; } }
      }

      /* ---------- start ---------- */
      (async function start() {
        try { const meta = await idbGet('meta'); if (meta && meta.wrappedDEK) { state.meta = meta; state.mode = 'unlock'; } else state.mode = 'create'; }
        catch (e) { state.mode = 'create'; }
        render();
      })();

      return function cleanup() {
        try { clearInterval(idleInt); clearTimeout(saveTimer); clearTimeout(toastTimer); } catch (e) {}
        globalOff.forEach(([ev, fn]) => { try { root.removeEventListener(ev, fn); } catch (e) {} });
        state.dek = null; state.data = null;
        try { root.innerHTML = ''; } catch (e) {}
      };
    }


  function __mount() {
    if (!document.getElementById('opcv-style')) {
      var st = document.createElement('style');
      st.id = 'opcv-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    var root = document.getElementById('root');
    if (root) boot(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __mount);
  else __mount();
})();
