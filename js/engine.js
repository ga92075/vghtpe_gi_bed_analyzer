/**
 * 病房簽床床位管理系統 - 自動排床核心引擎 (Engine)
 * 包含：
 * 1. BedConfigManager: 設定管理、Young V、病房輸入、床位查詢與持久化
 * 2. BedAssignmentEngine: 優先順位、房型意願、性別約束、借床限制、匈牙利最大匹配、4大方案產生器
 * 3. AIPromptGenerator: 去識別化資料與 Prompt 產出器
 */

if (typeof linearSumAssignment === 'undefined' && typeof require !== 'undefined') {
    var { linearSumAssignment } = require('./hungarian.js');
}

class BedConfigManager {
    static DEFAULT_YOUNG_V_CODES = "6410 1657 6254 6382 1729 1678";
    static CATEGORIES = ['男2', '女2', '雙空', '男4', '女4', '隔離', '單人', '留床'];
    static ASSIGNABLE_CATEGORIES = ['男2', '女2', '雙空', '男4', '女4', '隔離', '單人'];
    static STANDARD_WARDS = ['113', '121', '122', '123', '124'];
    static DEFAULT_TEST_WARD_BEDS = {
        "113": { "男2": "16 17", "女2": "", "雙空": "24 25", "男4": "", "女4": "", "隔離": "", "單人": "", "留床": "" },
        "121": { "男2": "", "女2": "", "雙空": "", "男4": "43", "女4": "1 2", "隔離": "", "單人": "", "留床": "" },
        "122": { "男2": "16", "女2": "33", "雙空": "31 32", "男4": "", "女4": "", "隔離": "", "單人": "", "留床": "" },
        "123": { "男2": "8 28", "女2": "", "雙空": "", "男4": "", "女4": "", "隔離": "", "單人": "39", "留床": "" },
        "124": { "男2": "1 2 21 22 23 24", "女2": "", "雙空": "3 5", "男4": "34 35 36", "女4": "", "隔離": "", "單人": "", "留床": "" }
    };
    static STORAGE_KEY = "bed_assignment_config_v2";
    static STORAGE_KEY_CONFIG = "bed_assignment_config_v2";
    static STORAGE_KEY_PATIENTS = "bed_assignment_patients_private_v2";

    constructor(data = null, patientData = null) {
        this.data = data || {};
        this.patientData = patientData || {};
        this.patientFilePath = "";
        this.youngVCodes = BedConfigManager.DEFAULT_YOUNG_V_CODES;
        this.testWardInputs = JSON.parse(JSON.stringify(BedConfigManager.DEFAULT_TEST_WARD_BEDS));
        this.inputs = {};
        for (const w of BedConfigManager.STANDARD_WARDS) {
            this.inputs[w] = {};
            for (const cat of BedConfigManager.CATEGORIES) {
                this.inputs[w][cat] = '';
            }
        }
    }

    setData(data) {
        this.data = data;
        this.applyLeaves();
        this.normalizePatientBeds();
    }

    setPatientData(patientData) {
        this.patientData = patientData;
        this.normalizePatientBeds();
    }

    getYoungVCodes() {
        return this.youngVCodes || "";
    }

    setYoungVCodes(codesStr) {
        this.youngVCodes = String(codesStr || '').trim();
    }

    getYoungVList() {
        if (!this.youngVCodes) return [];
        const raw = String(this.youngVCodes).replace(/，/g, ',').replace(/、/g, ',').split(/[,;\s]+/);
        const codes = [];
        for (const r of raw) {
            const c = r.replace(/\D/g, '');
            if (c && !codes.includes(c)) {
                codes.push(c);
            }
        }
        return codes;
    }

    getYoungVNames() {
        const codes = this.getYoungVList();
        if (!codes.length) return "";
        const results = [];
        for (const c of codes) {
            const doc = this.lookupDoctorByCode(c);
            if (doc && doc.name) {
                results.push(`${doc.name}(${c})`);
            } else {
                results.push(`醫師燈號:${c}`);
            }
        }
        return results.join(', ');
    }

    getDoctorHomeWard(codeStr) {
        const cleanCode = String(codeStr || '').replace(/\D/g, '');
        if (!cleanCode || !this.data || !this.data.wards) return "";
        let bestWard = "";
        let maxBeds = -1;
        for (const [w, wInfo] of Object.entries(this.data.wards)) {
            const normW = w.replace('A', '');
            for (const doc of (wInfo.doctors || [])) {
                const docClean = (doc.code || '').replace(/\D/g, '');
                if (docClean === cleanCode) {
                    const bCount = (doc.beds || []).length;
                    if (bCount > maxBeds) {
                        maxBeds = bCount;
                        bestWard = normW;
                    }
                }
            }
        }
        return bestWard;
    }

    _normalizeWardName(ward) {
        if (!this.data || !this.data.wards) return ward;
        const wards = this.data.wards;
        if (wards[ward]) return ward;
        if (wards['A' + ward]) return 'A' + ward;
        if (ward.startsWith('A') && wards[ward.slice(1)]) return ward.slice(1);
        return ward;
    }

    updateInput(ward, category, bedString) {
        if (!this.inputs[ward]) {
            this.inputs[ward] = {};
            for (const cat of BedConfigManager.CATEGORIES) {
                this.inputs[ward][cat] = '';
            }
        }
        this.inputs[ward][category] = bedString;
    }

    getInput(ward, category) {
        return (this.inputs[ward] && this.inputs[ward][category]) ? this.inputs[ward][category] : '';
    }

    clearWardInputs(ward) {
        if (this.inputs[ward]) {
            for (const cat of BedConfigManager.CATEGORIES) {
                this.inputs[ward][cat] = '';
            }
        }
    }

    clearAllInputs() {
        for (const w of Object.keys(this.inputs)) {
            for (const cat of BedConfigManager.CATEGORIES) {
                this.inputs[w][cat] = '';
            }
        }
    }

    lookupDoctorByCode(codeStr) {
        const cleanCode = String(codeStr || '').replace(/\D/g, '');
        if (!cleanCode || !this.data || !this.data.wards) return null;

        for (const wInfo of Object.values(this.data.wards)) {
            for (const doc of (wInfo.doctors || [])) {
                const docClean = (doc.code || '').replace(/\D/g, '');
                if (docClean === cleanCode || (doc.code && doc.code.includes(cleanCode))) {
                    return doc;
                }
            }
        }
        return null;
    }

    lookupDoctorByName(nameStr) {
        if (!nameStr || !this.data || !this.data.wards) return null;
        const cleanName = String(nameStr).trim();
        for (const wInfo of Object.values(this.data.wards)) {
            for (const doc of (wInfo.doctors || [])) {
                const dName = (doc.name || '').trim();
                if (dName && (cleanName.includes(dName) || dName.includes(cleanName))) {
                    return doc;
                }
            }
        }
        return null;
    }

    lookupBed(ward, bedNum) {
        const normWard = this._normalizeWardName(ward);
        const wardInfo = (this.data && this.data.wards) ? this.data.wards[normWard] : null;

        let matchedDoc = null;
        if (wardInfo) {
            for (const doc of (wardInfo.doctors || [])) {
                if ((doc.beds || []).includes(bedNum) || (doc.beds || []).includes(parseInt(bedNum, 10))) {
                    matchedDoc = doc;
                    break;
                }
            }
        }

        let isIsolation = false;
        const bInt = parseInt(bedNum, 10);
        if (normWard === 'A121' && bInt >= 34 && bInt <= 37) isIsolation = true;
        else if (normWard === 'A122' && bInt >= 36 && bInt <= 37) isIsolation = true;
        else if (normWard === 'A123' && bInt >= 36 && bInt <= 37) isIsolation = true;

        let bedType = "健保床";
        let isCoPay = false;
        if (normWard === 'A122') {
            if ((bInt >= 1 && bInt <= 5) || (bInt >= 42 && bInt <= 46)) {
                bedType = "健保床";
                isCoPay = false;
            } else {
                bedType = "差額床 (2人房2400/單人5000)";
                isCoPay = true;
            }
        }

        const result = {
            ward,
            norm_ward: normWard,
            bed_num: bedNum,
            doctor_name: matchedDoc ? matchedDoc.name : "未指定醫師",
            doctor_code: matchedDoc ? matchedDoc.code : "",
            clean_doc_code: matchedDoc ? (matchedDoc.code || '').replace(/\D/g, '') : "",
            leave_status: (matchedDoc && !matchedDoc.leave_info) ? "在勤" : "未知",
            proxy_doctor: "",
            leave_period: "",
            is_isolation: isIsolation,
            bed_type: bedType,
            is_co_pay: isCoPay,
            raw_assigned_string: matchedDoc ? matchedDoc.bed_str : ""
        };

        if (matchedDoc && matchedDoc.leave_info) {
            result.leave_status = "⚠️ 請假中";
            result.proxy_doctor = matchedDoc.leave_info.proxy || "";
            result.leave_period = matchedDoc.leave_info.period || "";
        }

        return result;
    }

    applyLeaves() {
        if (!this.data || !this.data.wards) return;
        const leaves = this.data.leaves || [];
        for (const wInfo of Object.values(this.data.wards)) {
            for (const doc of (wInfo.doctors || [])) {
                const dName = doc.name || '';
                const matchL = leaves.find(l => l.doctor === dName || (l.doctor && dName && (l.doctor.includes(dName) || dName.includes(l.doctor))));
                doc.leave_info = matchL || null;
            }
        }
    }

    saveSharedConfig() {
        if (typeof localStorage === 'undefined') return;
        try {
            // 嚴格共用設定：絕不含有病人資料
            const payload = this.exportConfigObject(false);
            localStorage.setItem(BedConfigManager.STORAGE_KEY_CONFIG, JSON.stringify(payload));
        } catch (e) {
            console.error("儲存共用設定至 localStorage 失敗:", e);
        }
    }

    loadSharedConfig() {
        if (typeof localStorage !== 'undefined') {
            try {
                const raw = localStorage.getItem(BedConfigManager.STORAGE_KEY_CONFIG) || localStorage.getItem(BedConfigManager.STORAGE_KEY);
                if (raw) {
                    const payload = JSON.parse(raw);
                    this.importConfigObject(payload, false); // 永遠不載入病人資料
                    return true;
                }
            } catch (e) {
                console.error("從 localStorage 讀取共用設定失敗:", e);
            }
        }
        // 若 localStorage 尚無資料，且已預載 window.DEFAULT_BED_CONFIG，則自動套用預設配置
        if (typeof window !== 'undefined' && window.DEFAULT_BED_CONFIG) {
            this.importConfigObject(window.DEFAULT_BED_CONFIG, false);
            return true;
        }
        return false;
    }

    savePrivatePatients(originalPatientData = null) {
        if (typeof localStorage === 'undefined') return;
        try {
            const payload = {
                patientData: this.patientData || { file_name: '', parsed_at: '', patients: [] },
                originalPatientData: originalPatientData || null,
                savedAt: new Date().toISOString()
            };
            localStorage.setItem(BedConfigManager.STORAGE_KEY_PATIENTS, JSON.stringify(payload));
        } catch (e) {
            console.error("儲存本機私有病人資料至 localStorage 失敗:", e);
        }
    }

    loadPrivatePatients() {
        if (typeof localStorage === 'undefined') return null;
        try {
            // 優先讀取專屬私有儲存區
            const raw = localStorage.getItem(BedConfigManager.STORAGE_KEY_PATIENTS);
            if (raw) {
                const payload = JSON.parse(raw);
                if (payload && payload.patientData && payload.patientData.patients) {
                    this.patientData = payload.patientData;
                    this.normalizePatientBeds();
                    return payload;
                }
            }
            // 舊版向下相容相容性遷移
            const legacyRaw = localStorage.getItem(BedConfigManager.STORAGE_KEY);
            if (legacyRaw) {
                const legacy = JSON.parse(legacyRaw);
                if (legacy.patient_data && legacy.patient_data.patients && legacy.patient_data.patients.length > 0) {
                    this.patientData = legacy.patient_data;
                    this.normalizePatientBeds();
                    this.savePrivatePatients(legacy.patient_data);
                    // 清除舊儲存中的病人資料以防洩漏
                    delete legacy.patient_data;
                    localStorage.setItem(BedConfigManager.STORAGE_KEY, JSON.stringify(legacy));
                    return { patientData: this.patientData, originalPatientData: null };
                }
            }
            return null;
        } catch (e) {
            console.error("讀取本機私有病人資料失敗:", e);
            return null;
        }
    }

    clearPrivatePatients() {
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.removeItem(BedConfigManager.STORAGE_KEY_PATIENTS);
                const legacyRaw = localStorage.getItem(BedConfigManager.STORAGE_KEY);
                if (legacyRaw) {
                    const legacy = JSON.parse(legacyRaw);
                    if (legacy.patient_data) {
                        delete legacy.patient_data;
                        localStorage.setItem(BedConfigManager.STORAGE_KEY, JSON.stringify(legacy));
                    }
                }
            } catch (e) {
                console.error("清除本機病人暫存失敗:", e);
            }
        }
        this.patientData = { file_name: '', parsed_at: '', patients: [] };
    }

    saveToLocalStorage() {
        this.saveSharedConfig();
        this.savePrivatePatients();
    }

    loadFromLocalStorage() {
        const configLoaded = this.loadSharedConfig();
        const patientsLoaded = this.loadPrivatePatients();
        return configLoaded || Boolean(patientsLoaded);
    }

    exportConfigObject(includePatients = false) {
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        return {
            metadata: {
                file_name: (this.data && this.data.file_name) || '',
                version: (this.data && this.data.version) || '',
                patient_file: includePatients ? ((this.patientData && this.patientData.file_name) || '') : '',
                updated_at: dateStr
            },
            patient_file_path: '',
            patient_data: includePatients ? ((this.patientData && this.patientData.patients && this.patientData.patients.length) ? this.patientData : null) : null,
            young_v_codes: this.youngVCodes,
            rules_and_info: {
                extensions: (this.data && this.data.extensions) || [],
                pricing: (this.data && this.data.pricing) || [],
                rules: (this.data && this.data.rules) || []
            },
            leaves: (this.data && this.data.leaves) || [],
            ward_category_inputs: this.inputs,
            test_ward_inputs: this.testWardInputs || BedConfigManager.DEFAULT_TEST_WARD_BEDS,
            wards: (this.data && this.data.wards) || {}
        };
    }

    importConfigObject(payload, importPatients = false) {
        if (!payload) return;
        this.youngVCodes = payload.young_v_codes || BedConfigManager.DEFAULT_YOUNG_V_CODES;
        this.data = {
            file_name: payload.metadata?.file_name || '',
            version: payload.metadata?.version || '',
            extensions: payload.rules_and_info?.extensions || [],
            pricing: payload.rules_and_info?.pricing || [],
            rules: payload.rules_and_info?.rules || [],
            leaves: payload.leaves || [],
            wards: payload.wards || {}
        };
        if (payload.ward_category_inputs) {
            this.inputs = JSON.parse(JSON.stringify(payload.ward_category_inputs));
        }
        if (payload.test_ward_inputs) {
            this.testWardInputs = JSON.parse(JSON.stringify(payload.test_ward_inputs));
        } else if (payload.ward_category_inputs) {
            this.testWardInputs = JSON.parse(JSON.stringify(payload.ward_category_inputs));
        } else {
            this.testWardInputs = JSON.parse(JSON.stringify(BedConfigManager.DEFAULT_TEST_WARD_BEDS));
        }
        this.patientFilePath = '';
        if (importPatients && payload.patient_data && payload.patient_data.patients) {
            this.patientData = payload.patient_data;
        }
        this.applyLeaves();
        this.normalizePatientBeds();
    }

    normalizePatientBeds() {
        const pData = this.patientData || this.patient_data;
        if (!pData || !pData.patients || !this.data || !this.data.wards) return;

        const nameToCode = {};
        for (const wInfo of Object.values(this.data.wards)) {
            for (const doc of (wInfo.doctors || [])) {
                const c = (doc.code || '').replace(/\D/g, '');
                if (c && doc.name) nameToCode[doc.name.trim()] = c;
            }
        }

        const leaveDocToProxy = {};
        for (const l of (this.data.leaves || [])) {
            const leaveName = (l.doctor || '').trim();
            const proxyName = (l.proxy || '').trim();
            const leaveC = nameToCode[leaveName] || leaveName.replace(/\D/g, '');
            const proxyC = nameToCode[proxyName] || proxyName.replace(/\D/g, '');
            if (leaveC && proxyC) {
                leaveDocToProxy[leaveC] = proxyC;
                leaveDocToProxy[leaveName] = proxyC;
            }
        }

        for (const p of pData.patients) {
            const pClean = String(p.doc_code || '').replace(/\D/g, '') || (p.doctor ? nameToCode[p.doctor.trim()] : '');
            const statusBed = String(p.status_bed || '').trim();
            if (!statusBed || statusBed.toLowerCase().includes('delay') || statusBed.includes('待') || ['-', '無'].includes(statusBed)) continue;

            const parsed = typeof ExcelPatientParser !== 'undefined' ? ExcelPatientParser.parsePreassignedBed(statusBed) : null;
            if (!parsed) continue;

            const ward = parsed.ward || parsed[0];
            const bedNum = parsed.bedNum || parsed[1];
            const bInt = parseInt(bedNum, 10);
            if (isNaN(bInt)) continue;

            const bedInfo = this.lookupBed(ward, bInt);
            if (!bedInfo) continue;

            const bedDocCode = bedInfo.clean_doc_code || '';
            let bedProxy = leaveDocToProxy[bedDocCode] || leaveDocToProxy[bedInfo.doctor_name];
            if (!bedProxy && bedInfo.proxy_doctor) {
                bedProxy = nameToCode[bedInfo.proxy_doctor] || bedInfo.proxy_doctor.replace(/\D/g, '');
            }

            const isOwn = (bedDocCode === pClean);
            const isProxyBorrow = Boolean(bedProxy && pClean === bedProxy);

            let targetSuffix = "";
            if (isProxyBorrow) {
                targetSuffix = `(${bedProxy})`;
            } else if (!isOwn) {
                const effectiveCode = bedProxy || bedDocCode;
                if (effectiveCode) targetSuffix = `(${effectiveCode})`;
            } else {
                const pProxy = leaveDocToProxy[pClean] || (p.doctor ? leaveDocToProxy[p.doctor.trim()] : '');
                if (pProxy) targetSuffix = `(${pProxy})`;
            }

            const hasParen = /\(.*?\)/.test(statusBed);
            if (!hasParen && targetSuffix) {
                const newStatus = `${ward}-${bedNum} ${targetSuffix}`;
                p.status_bed = newStatus;
                p.assigned_ward = ward;
                p.assigned_bed = String(bedNum);
                p.is_assigned = true;
            }

            for (let k = 1; k <= 4; k++) {
                const sk = `status_bed_${k}`;
                const sVal = String(p[sk] || '').trim();
                if (sVal && !sVal.toLowerCase().includes('delay') && !sVal.includes('待') && !['-', '無'].includes(sVal)) {
                    const sParsed = typeof ExcelPatientParser !== 'undefined' ? ExcelPatientParser.parsePreassignedBed(sVal) : null;
                    const sWard = sParsed ? (sParsed.ward || sParsed[0]) : '';
                    const sBnum = sParsed ? (sParsed.bedNum || sParsed[1]) : '';
                    if (sParsed && sWard === ward && sBnum === bedNum && !/\(.*?\)/.test(sVal) && targetSuffix) {
                        p[sk] = `${ward}-${bedNum} ${targetSuffix}`;
                    }
                }
            }
        }
    }
}

class BedAssignmentEngine {
    static DOC_1782 = '1782';
    static DOC_1772 = '1772';
    static DOC_1699 = '1699';
    static DOC_1691 = '1691';
    static DOCS_124_GROUP = ['1699', '1691', '1782'];
    static RULE2_PREFERRED_BORROW_DOCS = ['1699', '1691'];
    static RULE3_DEPRIORITIZED_BORROW_DOCS = new Set(['1772', '5383', '5380', '1403']);
    static SHORT_STAY_KEYWORDS = ['一日', '1日', '三天兩夜', '3天2夜', '三天2夜', '3天兩夜', '兩天一夜', '2天1夜', '兩天1夜', '2天一夜', '短天數'];
    static ER_EICU_REGEX = /(?:(?<=[^\w])|^|(?<=[\u4e00-\u9fa5]))(er|eicu)(?:(?=[^\w])|$|(?=[\u4e00-\u9fa5]))|急診/i;

    static isErEicuPatient(p) {
        if (!p) return false;
        const textFields = [
            String(p.contact || ''),
            String(p.arrival || ''),
            String(p.cond || ''),
            String(p.protocol || ''),
            String(p.note || ''),
            String(p.bed_pref || '')
        ];
        const combined = textFields.join(' ');
        return this.ER_EICU_REGEX.test(combined);
    }

    static isShortStayPatient(p) {
        if (!p) return false;
        const textFields = [
            String(p.cond || ''),
            String(p.protocol || ''),
            String(p.note || ''),
            String(p.diagnosis || ''),
            String(p.contact || ''),
            String(p.arrival || '')
        ];
        const combined = textFields.join(' ');
        return this.SHORT_STAY_KEYWORDS.some(k => combined.includes(k));
    }

    static canDoctorBorrowBed(docCode, bed) {
        const bDoc = bed.clean_doc_code || '';
        const bWard = String(bed.ward || '').replace('A', '');

        // 1. 1782 與 1772 不能互借
        if (docCode === this.DOC_1782 && bDoc === this.DOC_1772) return false;
        if (docCode === this.DOC_1772 && bDoc === this.DOC_1782) return false;

        // 2. 1772 不能借 124 的床位
        if (docCode === this.DOC_1772 && bWard === '124') return false;

        // 3. 1782 不能借 121 的床位
        if (docCode === this.DOC_1782 && bWard === '121') return false;

        // 4. 1782 的床位不能借給非 124 核心群醫師
        if (bDoc === this.DOC_1782 && !this.DOCS_124_GROUP.includes(docCode)) return false;

        return true;
    }

    static isStrict2Only(prefStr) {
        if (!prefStr) return false;
        const pClean = String(prefStr).replace(/nhi/gi, '健保').trim();
        const pLower = pClean.toLowerCase();

        if (['不排4', '不要4', '不可4', '不排四', '不要四', '不四', '不4'].some(k => pClean.includes(k))) {
            return true;
        }
        if (['必健保2', '必健2', '必2'].some(k => pClean.includes(k))) {
            return true;
        }
        if (['only', '只有', '只能', '只要', '限'].some(k => pLower.includes(k))) {
            if (['健保2', '健2', '2人', '雙人', '2'].some(k => pClean.includes(k))) {
                return true;
            }
        }
        return false;
    }

    static is2To4Intent(prefStr) {
        if (!prefStr) return true;
        const pClean = String(prefStr).replace(/nhi/gi, '健保').trim();
        if (this.isStrict2Only(pClean)) return false;

        if (pClean.includes('4') || pClean.includes('四') || pClean.includes('都可')) {
            return true;
        }
        if (pClean.includes('健保') || pClean.includes('健2')) {
            return true;
        }
        if (['優先', '雙人', '2人', '2'].some(k => pClean.includes(k))) {
            if ((pClean.includes('單') || pClean.includes('1') || pClean.includes('$')) && !['優先', '健保'].some(k => pClean.includes(k))) {
                return false;
            }
            return true;
        }
        return false;
    }

    static getPatientEffectivePref(p) {
        if (!p) return "2>4";
        const norm = String(p.normalized_pref || '').trim();
        if (norm && !['-', '都可', '無'].includes(norm)) return norm;
        const raw = String(p.bed_pref || '').trim();
        if (raw && !['-', '都可', '無'].includes(raw)) return this.getNormalizedPreference(raw);
        return "2>4";
    }

    static getPreferenceChoiceCount(p) {
        const effPref = this.getPatientEffectivePref(p);
        const [orderCriteria] = this.parsePreference(effPref);
        return (orderCriteria && orderCriteria.length > 0) ? orderCriteria.length : 99;
    }

    /**
     * 依校正後意願計算同位階、同順位(delay)時之排序鍵值：
     * 1. choiceCount: 可接受房型種類數 (越少越優先，只有1種 -> 2種 -> 3種 -> 4種)
     * 2. prefRank: 同種類數中之優先梯次：
     *    - 只有 1 種 (choiceCount === 1): 只有 1 (rank 1) -> 只有 2 (rank 2) -> 只有 2$ (rank 3) -> 只有 4 (rank 4)
     *    - 只有 2 種 (choiceCount === 2): 2>2$ (rank 1, 雙人房不住4) -> 1>2$ (rank 2) -> 2>4 / 4>2 (rank 3, 可住4人房)
     *    - 只有 3 種 (choiceCount === 3): 1>2>2$ / 1>2$>2 (rank 1, 不住4人房) -> 2>2$>4 (rank 2, 可住4人房)
     * 3. randVal: 前述皆相同時，以隨機亂數打破原輸入順序
     */
    static getPreferenceSortKey(p) {
        if (!p) return [99, 99, 0.0];
        const effPref = this.getPatientEffectivePref(p);
        const [orderCriteria] = this.parsePreference(effPref);
        const choiceCount = (orderCriteria && orderCriteria.length > 0) ? orderCriteria.length : 99;

        const hasSingle = orderCriteria.includes('single');
        const hasNhi2 = orderCriteria.includes('nhi_2');
        const hasCopay2 = orderCriteria.includes('co_pay_2');
        const has4 = orderCriteria.includes('nhi_4');

        let prefRank = 0;
        if (choiceCount === 1) {
            if (hasSingle) {
                prefRank = 1;   // 只有 1
            } else if (hasNhi2) {
                prefRank = 2;   // 只有 2
            } else if (hasCopay2) {
                prefRank = 3;   // 只有 2$
            } else if (has4) {
                prefRank = 4;   // 只有 4
            } else {
                prefRank = 5;
            }
        } else if (choiceCount === 2) {
            if (hasNhi2 && hasCopay2) {
                prefRank = 1;   // 2>2$ 或 2$>2 (雙人房，不住4)
            } else if (!has4) {
                prefRank = 2;   // 1>2$ 或 1>2 (其他不住4之雙組合)
            } else if ((hasNhi2 || hasCopay2) && has4) {
                prefRank = 3;   // 2>4 或 4>2 (雙人+4)
            } else {
                prefRank = 4;   // 其他含4組合 (如 1>4)
            }
        } else if (choiceCount === 3) {
            if (!has4) {
                prefRank = 1;   // 1>2>2$ (單人+雙人，不住4)
            } else if (hasNhi2 && hasCopay2 && has4) {
                prefRank = 2;   // 2>2$>4 (雙人+4)
            } else {
                prefRank = 3;   // 其他含4組合 (如 1>2>4)
            }
        } else {
            prefRank = 1;
        }

        const randVal = (p._rand_tie !== undefined && p._rand_tie !== null) ? p._rand_tie : 0.0;
        return [choiceCount, prefRank, randVal];
    }

    static has124WardPriority(p) {
        if (!p) return false;
        const s = `${p.bed_pref || ''} ${p.normalized_pref || ''} ${p.cond || ''}`;
        return /(?:124\s*(?:病房)?\s*優先|優先\s*(?:住|進)?\s*124(?:\s*病房)?)/i.test(s);
    }

    static getNormalizedPreference(prefStr) {
        let p = String(prefStr || '').trim();
        if (!p || ['-', '都可', '無'].includes(p)) return "2>4";

        let pClean = p.replace(/nhi/gi, '健保');

        // 移除 124 優先等病房註記以純化房型 (1, 2$, 2, 4) 判定
        let pCleanRoom = pClean.replace(/(?:124\s*(?:病房)?\s*優先|優先\s*(?:住|進)?\s*124(?:\s*病房)?)/gi, '').trim();
        if (!pCleanRoom) return "2>4";

        // 1. 特殊精確字串優先對照
        // 規則 A: 必2人房、2人床 (NHI > $)、2人(差額可) 轉換成 2>2$
        if (['必2人房', '必2人'].includes(pCleanRoom) || /^必2人(?:房)?$/i.test(pCleanRoom)) {
            return "2>2$";
        }
        if (/(?:2人|雙人)(?:床|房)?\s*[\(（]\s*(?:健保|nhi)\s*>\s*\$\s*[\)）]/i.test(pCleanRoom) ||
            (/(?:健保|nhi)\s*>\s*\$/i.test(pCleanRoom) && /(?:2人|雙人|2)/.test(pCleanRoom) && !/(?:4|四)/.test(pCleanRoom))) {
            return "2>2$";
        }
        if (/(?:2人|雙人)\s*[\(（]\s*(?:差額|自費)(?:可|ok)?\s*[\)）]/i.test(pCleanRoom) ||
            /(?:2人|雙人)\s*[\(（]\s*可(?:差額|自費)\s*[\)）]/i.test(pCleanRoom)) {
            return "2>2$";
        }

        // 規則 B: 單人>榮民 轉換成 1>2$>2
        if (/(?:單人|單|1)\s*>\s*榮(?:民)?/i.test(pCleanRoom)) {
            return "1>2$>2";
        }
        if (/榮(?:民)?\s*>\s*(?:單人|單|1)/i.test(pCleanRoom)) {
            return "2$>2>1";
        }

        // 規則 C: 1 > 2 或 1>2 轉換成 1>2>2$
        if (/^(?:單人|單|1)\s*>\s*(?:2|2人|雙人)$/i.test(pCleanRoom)) {
            return "1>2>2$";
        }

        // 規則 D: 健保2>單 轉換成 2>2$>1 (排斥4)
        if (/^(?:健保\s*)?2(?:人)?\s*>\s*(?:單人|單|1)$/i.test(pCleanRoom)) {
            return "2>2$>1";
        }

        // 若已為標準 token (1, 2$, 4, VIP) 或標準箭頭語法鏈 (1>2$>2, 2>4, 2$>2 等)
        const rawTokens = pCleanRoom.split('>').map(t => t.trim()).filter(Boolean);
        const allStd = rawTokens.length > 0 && rawTokens.every(tok =>
            ['1', '2$', '2', '4'].includes(tok) || /^1\((192|119|129)\)$/.test(tok)
        );
        if (allStd) {
            // 特殊二元組合映射
            if (rawTokens.length === 2 && rawTokens[0] === '1' && rawTokens[1] === '2') {
                return "1>2>2$";
            }
            if (rawTokens.length === 2 && rawTokens[0] === '2' && rawTokens[1] === '1') {
                return "2>2$>1";
            }
            // 單一 '2' 若來自原始非箭頭字串，按現行常規預設視為 2>4；其餘標準單一 token (1, 2$, 4, VIP) 或箭頭鏈直接返回
            if (rawTokens.length === 1 && rawTokens[0] === '2' && !pCleanRoom.includes('>')) {
                // 走後續一般判定
            } else {
                return rawTokens.join('>');
            }
        }

        if (pCleanRoom.includes('榮')) return "2$>2>4";
        if (pCleanRoom.includes('不限價位')) return "1>1(192)>1(119)>1(129)";

        const vips = [];
        for (const rm of ['192', '119', '129']) {
            const m = pClean.match(new RegExp(`(?<!\\d)${rm}(?!\\d)`));
            if (m) {
                vips.push({ idx: m.index, val: `1(${rm})` });
            }
        }
        vips.sort((a, b) => a.idx - b.idx);
        const vipItems = vips.map(v => v.val);

        const pSub = pClean.replace(/(?<!\d)\d+f(?!\d)/gi, '');
        const pSubNoRoom = pSub.replace(/(?<!\d)(113|121|122|123|124|192|119|129)(?!\d)/g, '');

        let pNoVipsOrWards = pClean.replace(/1?\s*[\(（]\s*(192|119|129)\s*[\)）]/g, '     ');
        pNoVipsOrWards = pNoVipsOrWards.replace(/(?<!\d)(113|121|122|123|124|192|119|129)(?!\d)/g, '   ');
        pNoVipsOrWards = pNoVipsOrWards.replace(/(?<!\d)\d+f(?!\d)/gi, '  ');
        const mGen1 = pNoVipsOrWards.match(/(?<!\d)1(?!\d)|單/);

        if (vipItems.length && !['2', '雙', '兩', '4', '健保'].some(k => pSubNoRoom.includes(k))) {
            if (mGen1) {
                const combined = [{ idx: mGen1.index, val: "1" }, ...vips];
                combined.sort((a, b) => a.idx - b.idx);
                const res = [];
                const seen = new Set();
                for (const item of combined) {
                    if (!seen.has(item.val)) {
                        seen.add(item.val);
                        res.push(item.val);
                    }
                }
                return res.join('>');
            }
            return vipItems.join('>');
        }

        const strictKeywords = ['only', '只有', '只能', '只要', '限', '必', '一定要', '只'];
        const pLower = pClean.toLowerCase();
        const hasStrict = strictKeywords.some(k => pLower.includes(k));

        // 只有 1 (單人房)
        let isSingleOnly = false;
        if (['1', '單人', '單'].includes(pClean) ||
            ['單人only', 'only單人', '必單人', '一定要', '單人only!!', '只住單人', '只單人', '只要單人', '必1', '只有1', '1only', '1 only'].some(x => pLower.includes(x)) ||
            (pLower.includes('單人') && pLower.includes('only')) ||
            (hasStrict && (pClean.includes('單') || /(?<!\d)1(?!\d)/.test(pClean)))) {
            if (!['>2', '>4', '2人', '雙人', '健保', '兩', 'or', '>', '2$', '$2'].some(k => pSubNoRoom.includes(k))) {
                isSingleOnly = true;
            }
        }
        if (isSingleOnly) {
            if (vipItems.length) return vipItems.join('>');
            return "1";
        }

        // 只有 2$ (差額雙人房)
        if ((hasStrict && (pClean.includes('2$') || pClean.includes('$2') || (pClean.includes('$') && (pClean.includes('2') || pClean.includes('雙') || pClean.includes('兩'))))) ||
            ['2$', '$2'].includes(pClean)) {
            if (!['4', '四'].some(k => pClean.includes(k)) && !['>2', '2>', '健保2', '健2'].some(k => pClean.includes(k))) {
                return "2$";
            }
        }

        // 只有 4 (四人床)
        if ((hasStrict && (pClean.includes('4') || pClean.includes('四'))) || ['4', '四'].includes(pClean)) {
            if (!['1', '單', '2', '雙', '兩', '健保'].some(k => pSubNoRoom.includes(k))) {
                return "4";
            }
        }

        // 只有 2 (健保雙人床)
        if (this.isStrict2Only(pClean)) {
            if (['$', '2$', '$2', '可自費'].some(x => pClean.includes(x))) {
                return "2>2$";
            }
            return "2";
        }

        let isStrictNhi = false;
        if (['必健保', '無法自費', '只能健保', '限健保', '只能住健保', '差額不可', '只排健保床'].some(x => pClean.includes(x))) {
            isStrictNhi = true;
        } else if (pClean.toLowerCase().includes('only') && pClean.includes('健保')) {
            isStrictNhi = true;
        }

        let hasCopay = false;
        if (!isStrictNhi) {
            if (['$', '2$', '$2', '可自費', '$ok', '$OK', '2$'].some(x => pClean.includes(x)) || pClean.includes('$')) {
                hasCopay = true;
            } else if (pClean.includes('自費') && !pClean.includes('無法自費')) {
                hasCopay = true;
            }
        }

        const hasSingle = pClean.includes('單') || /(?<!\d)1(?![\dFf])/.test(pSubNoRoom) || vipItems.length > 0;
        if (hasSingle) {
            const idxSingle = Math.min(...['單', '1'].map(x => pClean.indexOf(x)).filter(i => i !== -1), 999);
            const idxTwo = Math.min(...['2', '雙', '兩', '$'].map(x => pClean.indexOf(x)).filter(i => i !== -1), 999);
            let base = idxTwo < idxSingle ? ['2', '2$', '1'] : ['1', '2$', '2'];
            if (pSubNoRoom.includes('4') || pSubNoRoom.includes('四') || (pClean.includes('健保') && !/^(?:健保\s*)?2(?:人)?\s*>\s*(?:單人|單|1)/i.test(pCleanRoom))) {
                base.push('4');
            }
            const final = [];
            for (const x of base) {
                if (x === '1' && vipItems.length) {
                    if (mGen1) {
                        const combined = [{ idx: mGen1.index, val: "1" }, ...vips];
                        combined.sort((a, b) => a.idx - b.idx);
                        const seen = new Set();
                        for (const itm of combined) {
                            if (!seen.has(itm.val)) {
                                seen.add(itm.val);
                                final.push(itm.val);
                            }
                        }
                    } else {
                        final.push(...vipItems);
                    }
                } else {
                    final.push(x);
                }
            }
            return final.join('>');
        }

        if (pClean.includes('2>4>$2') || pClean.includes('2>4>2$')) return "2>4>2$";
        if (pClean.includes('2>2$') || pClean.includes('2>$2') || pClean.includes('健保 > $') || pClean.includes('健保>$')) {
            return this.is2To4Intent(pClean) ? "2>2$>4" : "2>2$";
        }
        if (pClean.includes('2$>2') || pClean.includes('$2>2') || pClean.includes('$2>健保') || pClean.includes('2$>健保') || pClean.includes('$>健保')) {
            return this.is2To4Intent(pClean) ? "2$>2>4" : "2$>2";
        }

        if (pClean.includes('$2') || pClean.includes('2$')) {
            const mCopay = pClean.match(/\$2|2\$|\$/);
            const mNhi = pClean.match(/(?<![\$\d])2(?![\$\d])|健保|雙|兩/);
            const idxCopay = mCopay ? mCopay.index : 999;
            const idxNhi = mNhi ? mNhi.index : 999;
            if (idxCopay < idxNhi) {
                return this.is2To4Intent(pClean) ? "2$>2>4" : "2$>2";
            } else {
                return this.is2To4Intent(pClean) ? "2>2$>4" : "2>2$";
            }
        }

        if (hasCopay) {
            return this.is2To4Intent(pClean) ? "2>2$>4" : "2>2$";
        }

        if (pClean.includes('4') || pClean.includes('4人') || pClean.includes('四')) {
            const idxFour = Math.min(...['4', '四'].map(x => pClean.indexOf(x)).filter(i => i !== -1), 999);
            const idxTwo = Math.min(...['2', '雙', '兩'].map(x => pClean.indexOf(x)).filter(i => i !== -1), 999);
            return idxFour < idxTwo ? "4>2" : "2>4";
        }

        if (this.is2To4Intent(pClean)) {
            return "2>4";
        }
        return "2";
    }

    static parsePreference(prefStr) {
        let p = String(prefStr || '').trim();
        if (!p || ['-', '都可', '無'].includes(p)) {
            return [['nhi_2', 'nhi_4'], false];
        }

        let pClean = p.replace(/nhi/gi, '健保');
        const pLower = pClean.toLowerCase();

        // 1. 特殊單一標準 token (如 '1', '2', '2$', '1(192)', '4')
        if (['1', '單人', '單'].includes(pClean) || /^(?:1\(192\)|1\(119\)|1\(129\))$/.test(pClean)) {
            return [['single'], true];
        }
        if (['2$', '$2'].includes(pClean)) {
            return [['co_pay_2'], true];
        }
        if (pClean === '2') {
            return [['nhi_2'], false];
        }
        if (['4', '四'].includes(pClean)) {
            return [['nhi_4'], false];
        }

        // 2. 優先檢查是否需要標準化 (例如 1>2 需校正為 1>2>2$, 健保2>單 需校正為 2>2$>1, 必2人房 校正為 2>2$ 等)
        const norm = this.getNormalizedPreference(pClean);
        if (norm !== pClean && norm) {
            return this.parsePreference(norm);
        }

        // 3. 若為包含 '>' 的標準化鏈，依據 token 順序精確解析
        if (pClean.includes('>')) {
            const tokens = pClean.split('>').map(t => t.trim()).filter(Boolean);
            const order = [];
            let allowCoPay = false;
            for (const tok of tokens) {
                if (tok.includes('1') || tok.includes('單')) {
                    if (!order.includes('single')) order.push('single');
                    allowCoPay = true;
                } else if (tok.includes('2$') || tok.includes('$2') || (tok.includes('$') && (tok.includes('2') || tok.includes('雙') || tok.includes('兩')))) {
                    if (!order.includes('co_pay_2')) order.push('co_pay_2');
                    allowCoPay = true;
                } else if (tok === '2' || (tok.includes('2') && !tok.includes('$')) || tok.includes('雙') || tok.includes('健保')) {
                    if (!order.includes('nhi_2')) order.push('nhi_2');
                } else if (tok.includes('4') || tok.includes('四')) {
                    if (!order.includes('nhi_4')) order.push('nhi_4');
                }
            }
            if (order.length) return [order, allowCoPay];
        }

        const isStrict2 = this.isStrict2Only(pClean);
        const has4Allowed = this.is2To4Intent(pClean);

        let isStrictNhi = false;
        if (['必健保', '無法自費', '只能健保', '限健保', '只能住健保', '差額不可', '只排健保床'].some(x => pClean.includes(x))) {
            isStrictNhi = true;
        } else if (pLower.includes('only') && pClean.includes('健保')) {
            isStrictNhi = true;
        }

        const hasRule1Keyword = ['單', '單人', '1', '榮'].some(x => pClean.includes(x));
        let hasCopayKeyword = false;
        if (!isStrictNhi) {
            if (['$', '2$', '$2', '可自費', '$ok', '$OK', '2$'].some(x => pClean.includes(x)) || pClean.includes('$')) {
                hasCopayKeyword = true;
            } else if (pClean.includes('自費') && !pClean.includes('無法自費')) {
                hasCopayKeyword = true;
            }
        }

        if (isStrict2) {
            const allowCoPay = hasCopayKeyword && !isStrictNhi;
            return [allowCoPay ? ['nhi_2', 'co_pay_2'] : ['nhi_2'], allowCoPay];
        }

        let allowCoPay = (hasRule1Keyword || hasCopayKeyword) && !isStrictNhi;
        let order = [];

        if (isStrictNhi) {
            allowCoPay = false;
            order = has4Allowed ? ['nhi_2', 'nhi_4'] : ['nhi_2'];
        }

        const pSub = pClean.replace(/(?<!\d)\d+f(?!\d)/gi, '');
        const pSubNoRoom = pSub.replace(/(?<!\d)(113|121|122|123|124|192|119|129)(?!\d)/g, '');
        const isVipPref = /(?<!\d)(192|119|129)(?!\d)/.test(pClean) || pClean.includes('不限價位');
        const isVipWithoutDouble = isVipPref && !['2', '雙', '兩', '4', '健保'].some(k => pSubNoRoom.includes(k));

        if (isVipWithoutDouble) {
            order = ['single'];
            allowCoPay = true;
        } else if (['單人only', 'only單人', '必單人', '一定要', '單人only!!', '只住單人'].some(x => pClean.includes(x)) &&
            !['>2', '>4', '2人', '雙人', '健保', '兩', 'or'].some(k => pSubNoRoom.includes(k))) {
            order = ['single'];
            allowCoPay = true;
        } else if (pClean.includes('單') || pClean.includes('1')) {
            const idxSingle = Math.min(...['單', '1'].map(x => pClean.indexOf(x)).filter(i => i !== -1), 999);
            const idxTwo = Math.min(...['2', '雙', '兩', '$'].map(x => pClean.indexOf(x)).filter(i => i !== -1), 999);
            order = idxTwo < idxSingle ? ['nhi_2', 'co_pay_2', 'single'] : ['single', 'co_pay_2', 'nhi_2'];
            if (has4Allowed) order.push('nhi_4');
        } else if (pClean.includes('榮')) {
            order = ['co_pay_2', 'nhi_2', 'nhi_4'];
        } else if (pClean.includes('4') || pClean.includes('4人') || pClean.includes('四')) {
            const idxFour = Math.min(...['4', '四'].map(x => pClean.indexOf(x)).filter(i => i !== -1), 999);
            const idxTwo = Math.min(...['2', '雙', '兩'].map(x => pClean.indexOf(x)).filter(i => i !== -1), 999);
            order = idxFour < idxTwo ? ['nhi_4', 'nhi_2'] : ['nhi_2', 'nhi_4'];
        } else if (pClean.includes('2') || pClean.includes('雙') || pClean.includes('兩') || pClean.includes('健保')) {
            order = hasCopayKeyword ? ['nhi_2', 'co_pay_2'] : ['nhi_2'];
            if (has4Allowed) order.push('nhi_4');
        } else {
            order = has4Allowed ? ['nhi_2', 'nhi_4'] : ['nhi_2'];
        }

        if (!allowCoPay) {
            order = order.filter(x => x !== 'single' && x !== 'co_pay_2');
        }
        if (!has4Allowed) {
            order = order.filter(x => !x.includes('4'));
        }
        if (!order.length) order = ['nhi_2'];

        return [order, allowCoPay];
    }

    static bedMatchesCriterion(bed, criterion, gender, allowCoPay) {
        const cat = bed.category || '';
        const isCo = bed.is_co_pay || false;

        if (!allowCoPay && isCo) return false;

        if (cat === '單人') {
            // 單人不限性別
        } else if (cat === '男2' || cat === '男4') {
            if (gender !== 'M') return false;
        } else if (cat === '女2' || cat === '女4') {
            if (gender !== 'F') return false;
        } else if (cat === '雙空') {
            const lockedG = bed.locked_gender;
            if (lockedG && gender !== lockedG) return false;
        } else if (cat === '隔離') {
            // 隔離床男女性均可
        }

        if (criterion === 'single') return cat === '單人';
        if (criterion === 'co_pay_2') return ['男2', '女2', '雙空'].includes(cat) && isCo;
        if (criterion === 'nhi_2') return ['男2', '女2', '雙空', '隔離'].includes(cat) && !isCo;
        if (criterion === 'nhi_4') return ['男4', '女4'].includes(cat) && !isCo;
        if (criterion === 'any_2') return ['男2', '女2', '雙空', '隔離'].includes(cat);
        if (criterion === 'any_4') return ['男4', '女4'].includes(cat);

        return false;
    }

    /**
     * 全域二分圖最大匹配求解器 (支援雙空房性別互斥回溯約束)
     */
    static solveBipartiteMatching(patients, availableBeds, manager, docHomeWards, proxyToLeaveDocs, youngVList) {
        const numPts = patients.length;
        const numBeds = availableBeds.length;
        if (numPts === 0 || numBeds === 0) return {};

        const twinRooms = {};
        for (let idx = 0; idx < availableBeds.length; idx++) {
            const b = availableBeds[idx];
            if ((b.category === '雙空' || b.is_double_empty) && b.twin_partner !== undefined && b.twin_partner !== null) {
                const w = String(b.ward).replace('A', '');
                const p1 = String(b.bed_num);
                const p2 = String(b.twin_partner);
                const roomKey = `${w}_${[p1, p2].sort().join('_')}`;
                if (!twinRooms[roomKey]) twinRooms[roomKey] = [];
                twinRooms[roomKey].push(idx);
            }
        }

        const freeTwinRooms = [];
        for (const [rKey, bIndices] of Object.entries(twinRooms)) {
            if (bIndices.length === 2) {
                const b1 = availableBeds[bIndices[0]];
                const b2 = availableBeds[bIndices[1]];
                if (!b1.locked_gender && !b2.locked_gender) {
                    freeTwinRooms.push({ roomKey: rKey, bIndices });
                }
            }
        }

        const k = freeTwinRooms.length;
        let genderCombos = [];
        if (k === 0) {
            genderCombos = [{}];
        } else {
            // 產生 2^k 種組合
            const totalCombos = 1 << k;
            for (let mask = 0; mask < totalCombos; mask++) {
                const combo = {};
                for (let i = 0; i < k; i++) {
                    combo[freeTwinRooms[i].roomKey] = (mask & (1 << i)) ? 'M' : 'F';
                }
                genderCombos.push(combo);
            }
        }

        let bestTotalWeight = -1e12;
        let bestMatching = {};
        const N = Math.max(numPts, numBeds);

        for (const combo of genderCombos) {
            const costMatrix = [];
            const weightMatrix = [];
            for (let i = 0; i < N; i++) {
                costMatrix.push(new Array(N).fill(0.0));
            }
            for (let i = 0; i < numPts; i++) {
                weightMatrix.push(new Array(numBeds).fill(-1e9));
            }

            for (let pIdx = 0; pIdx < numPts; pIdx++) {
                const p = patients[pIdx];
                const gender = p.gender || 'M';
                const cleanDoc = String(p.doc_code || '').replace(/\D/g, '');
                const [orderCriteria, allowCo] = this.parsePreference(this.getPatientEffectivePref(p));
                const homeWard = docHomeWards[cleanDoc] || '';
                const proxiedDocs = proxyToLeaveDocs[cleanDoc] || [];

                let delayDays = p.initial_delay_days;
                if (delayDays === undefined || delayDays === null || delayDays === 0) {
                    delayDays = (typeof ExcelPatientParser !== 'undefined')
                        ? ExcelPatientParser.extractDelayDays(p.raw_status_bed || p.status_bed || '')
                        : 0;
                }

                const isEr = this.isErEicuPatient(p);
                const arr = String(p.arrival || '').trim();
                const isOntime = arr.includes('準時');
                const isShort = this.isShortStayPatient(p);

                for (let bIdx = 0; bIdx < numBeds; bIdx++) {
                    const b = availableBeds[bIdx];
                    let bTwinKey = null;
                    if ((b.category === '雙空' || b.is_double_empty) && b.twin_partner !== undefined && b.twin_partner !== null) {
                        const w = String(b.ward).replace('A', '');
                        const p1 = String(b.bed_num);
                        const p2 = String(b.twin_partner);
                        bTwinKey = `${w}_${[p1, p2].sort().join('_')}`;
                    }

                    const forcedGender = bTwinKey ? combo[bTwinKey] : null;
                    if (forcedGender && gender !== forcedGender) continue;
                    if (b.locked_gender && gender !== b.locked_gender) continue;

                    const bDoc = b.clean_doc_code || '';
                    const isOwn = (bDoc === cleanDoc);
                    if (!isOwn && !this.canDoctorBorrowBed(cleanDoc, b)) continue;

                    let matchedCritIdx = -1;
                    for (let cIdx = 0; cIdx < orderCriteria.length; cIdx++) {
                        if (this.bedMatchesCriterion(b, orderCriteria[cIdx], gender, allowCo)) {
                            matchedCritIdx = cIdx;
                            break;
                        }
                    }
                    if (matchedCritIdx === -1) continue;

                    let wScore = 1000000.0;
                    if (isOwn) {
                        wScore += 10000.0;
                    } else if (proxiedDocs.includes(bDoc)) {
                        wScore += 5000.0;
                    } else if (this.DOCS_124_GROUP.includes(cleanDoc) && this.DOCS_124_GROUP.includes(bDoc)) {
                        wScore += 3000.0;
                    }

                    if (homeWard && String(b.ward).replace('A', '') === homeWard) {
                        wScore += 2000.0;
                    }
                    if (isEr && youngVList.includes(bDoc)) {
                        wScore += 1000.0;
                    }

                    // 非優先借床醫師扣分 (1772, 5383, 5380, 1403): -4000 (僅在無其他床位可滿足時才考慮向其借床)
                    if (!isOwn && this.RULE3_DEPRIORITIZED_BORROW_DOCS.has(bDoc)) {
                        wScore -= 4000.0;
                    }

                    if (delayDays > 0) {
                        wScore += delayDays * 100000.0; // 延後病人最高優先權
                    }
                    const [choiceCount, prefRank] = this.getPreferenceSortKey(p);
                    wScore += (5 - Math.min(choiceCount, 5)) * 100.0 - prefRank * 10.0;
                    if (isOntime) wScore += 50.0;
                    if (isEr) wScore += 30.0;

                    // 124 病房優先意願加分 (+2500.0)
                    if (this.has124WardPriority(p) && String(b.ward).replace('A', '') === '124') {
                        wScore += 2500.0;
                    }

                    if (!isOwn && isShort) wScore += 100.0;
                    // 嚴格考慮病人 prefer 的順位 (第1意願 >> 第2意願 >> 第3意願)
                    wScore -= matchedCritIdx * 10000.0;

                    const randVal = (p._rand_tie !== undefined && p._rand_tie !== null) ? p._rand_tie : 0.0;
                    wScore += randVal * 1.0;

                    if ((b.category === '雙空' || b.is_double_empty) && b.twin_room_status === 'one_used') {
                        wScore += 400.0;
                    }

                    weightMatrix[pIdx][bIdx] = wScore;
                    costMatrix[pIdx][bIdx] = -wScore;
                }
            }

            const [rowInd, colInd] = linearSumAssignment(costMatrix);
            let totalW = 0.0;
            const matching = {};
            for (let kIdx = 0; kIdx < rowInd.length; kIdx++) {
                const r = rowInd[kIdx];
                const c = colInd[kIdx];
                if (r < numPts && c < numBeds) {
                    if (weightMatrix[r][c] > 0) {
                        totalW += weightMatrix[r][c];
                        matching[r] = c;
                    }
                }
            }

            if (totalW > bestTotalWeight) {
                bestTotalWeight = totalW;
                bestMatching = matching;
            }
        }

        return bestMatching;
    }

    /**
     * 執行單一策略排床運算
     */
    static _simulateAssignment(patients, availableBeds, manager, strategyMode = 'preserve_twin') {
        const logs = [];
        let stratTitle = strategyMode;
        if (strategyMode === 'preserve_twin') stratTitle = "策略 A (先保留雙空)";
        else if (strategyMode === 'prioritize_twin') stratTitle = "策略 B (先分配雙空)";
        else if (strategyMode === 'upgrade_2_copay') stratTitle = "策略二 (2$>2 優先排法)";
        else if (strategyMode === 'gender_shortage_twin') stratTitle = "方案 2 (雙空依性別缺額優先排法)";
        else if (strategyMode === 'global_bipartite') stratTitle = "方案 3 (全域二分圖最大匹配與回溯最佳化)";
        else if (strategyMode === 'bipartite_after_step2') stratTitle = "方案 4 (步驟2本床後全域二分圖匹配)";

        logs.push(`=== 開始執行自動排床運算 【${stratTitle}】 ===`);
        logs.push(`待排病人數: ${patients.length} 位 | 可用病床數: ${availableBeds.length} 床`);

        for (const p of patients) {
            if (p._rand_tie === undefined || p._rand_tie === null) {
                p._rand_tie = Math.random();
            }
        }

        const docHomeWards = {};
        const nameToCode = {};
        if (manager && manager.data && manager.data.wards) {
            const docWardBeds = {};
            for (const [wKey, wVal] of Object.entries(manager.data.wards)) {
                const normW = wKey.replace('A', '');
                for (const doc of (wVal.doctors || [])) {
                    const c = (doc.code || '').replace(/\D/g, '');
                    if (c) {
                        if (doc.name) nameToCode[doc.name] = c;
                        const bCount = (doc.beds || []).length;
                        if (!docWardBeds[c] || bCount > docWardBeds[c].beds) {
                            docWardBeds[c] = { ward: normW, beds: bCount };
                        }
                    }
                }
            }
            for (const [c, info] of Object.entries(docWardBeds)) {
                docHomeWards[c] = info.ward;
            }
        }

        const proxyToLeaveDocs = {};
        const leaveDocToProxy = {};
        if (manager && manager.data && manager.data.leaves) {
            for (const l of manager.data.leaves) {
                const leaveDocName = (l.doctor || '').trim();
                const proxyName = (l.proxy || '').trim();
                let leaveC = nameToCode[leaveDocName] || leaveDocName.replace(/\D/g, '');
                let proxyC = nameToCode[proxyName] || proxyName.replace(/\D/g, '');
                if (proxyC && leaveC) {
                    if (!proxyToLeaveDocs[proxyC]) proxyToLeaveDocs[proxyC] = [];
                    proxyToLeaveDocs[proxyC].push(leaveC);
                    leaveDocToProxy[leaveC] = proxyC;
                    leaveDocToProxy[leaveDocName] = proxyC;
                }
            }
        }

        const youngVList = (manager && typeof manager.getYoungVList === 'function') ? manager.getYoungVList() : [];
        if (youngVList.length) {
            logs.push(`Young V 衝勁醫師登錄燈號: ${youngVList.join(', ')} (優先收治急診病人)`);
        }

        const isPriorityArrival = (p) => String(p.arrival || '').trim().includes('準時');

        const tierSortKey = (p) => {
            let delayDays = p.initial_delay_days;
            if (delayDays === undefined || delayDays === null || delayDays === 0) {
                delayDays = (typeof ExcelPatientParser !== 'undefined')
                    ? ExcelPatientParser.extractDelayDays(p.raw_status_bed || p.status_bed || '')
                    : 0;
            }
            const [choiceCount, prefRank, randVal] = this.getPreferenceSortKey(p);
            return [-delayDays, choiceCount, prefRank, randVal, p.row_idx || 999];
        };

        const priorityArrivalSortKey = tierSortKey;
        const erPrioritySortKey = tierSortKey;
        const remainingSortKey = tierSortKey;
        const step3SortKey = tierSortKey;

        function multiKeySort(arr, keyFn) {
            return arr.slice().sort((a, b) => {
                const ka = keyFn(a);
                const kb = keyFn(b);
                for (let i = 0; i < ka.length; i++) {
                    if (ka[i] < kb[i]) return -1;
                    if (ka[i] > kb[i]) return 1;
                }
                return 0;
            });
        }

        // 收集已佔用床位
        const preoccupiedBeds = new Set();
        for (const p of patients) {
            const isManual = p.is_manual_assigned || false;
            const rawSt = String(p.raw_status_bed || '').trim();
            const hasRaw = Boolean(rawSt && !rawSt.toLowerCase().includes('delay') && !rawSt.includes('待') && !['-', '無'].includes(rawSt));
            if (!(isManual || hasRaw)) continue;

            let w = String(p.assigned_ward || '').trim().replace('A', '');
            let b = String(p.assigned_bed || '').trim();
            if (!w || !b) {
                const parsed = ExcelPatientParser.parsePreassignedBed(p.status_bed || '');
                if (parsed) {
                    w = parsed.ward;
                    b = parsed.bedNum;
                }
            }
            if (w && b) {
                if (['192', '119', '129'].includes(w)) continue;
                const bNorm = /^\d+$/.test(b) ? String(parseInt(b, 10)) : b;
                preoccupiedBeds.add(`${w}_${bNorm}`);
            }
        }

        let pool = availableBeds.map(b => Object.assign({}, b));
        for (const b of pool) {
            if (b.category === '雙空' || b.is_double_empty) {
                if (!b.twin_room_status) b.twin_room_status = 'both_empty';
            }
        }

        if (preoccupiedBeds.size > 0) {
            const origLen = pool.length;
            pool = pool.filter(b => {
                const w = String(b.ward).replace('A', '');
                const bNum = /^\d+$/.test(b.bed_num) ? String(parseInt(b.bed_num, 10)) : String(b.bed_num);
                return !preoccupiedBeds.has(`${w}_${bNum}`);
            });
            const removedCount = origLen - pool.length;
            if (removedCount > 0) {
                logs.push(`🔒 偵測到 ${removedCount} 張床位已被既有名單佔用，已從空床池中扣除。`);
            }

            for (const b of pool) {
                if ((b.category === '雙空' || b.is_double_empty) && b.twin_partner !== undefined && b.twin_partner !== null) {
                    const pNorm = /^\d+$/.test(b.twin_partner) ? String(parseInt(b.twin_partner, 10)) : String(b.twin_partner);
                    const wNorm = String(b.ward).replace('A', '');
                    if (preoccupiedBeds.has(`${wNorm}_${pNorm}`)) {
                        b.twin_room_status = 'one_used';
                        for (const p of patients) {
                            let pw = String(p.assigned_ward || '').trim().replace('A', '');
                            let pb = String(p.assigned_bed || '').trim();
                            if (!pw || !pb) {
                                const parsed = ExcelPatientParser.parsePreassignedBed(p.status_bed || '');
                                if (parsed) {
                                    pw = parsed.ward;
                                    pb = parsed.bedNum;
                                }
                            }
                            if (pw === wNorm && (/^\d+$/.test(pb) ? String(parseInt(pb, 10)) : pb) === pNorm) {
                                b.locked_gender = p.gender || 'M';
                                break;
                            }
                        }
                    }
                }
            }
        }

        let assignedCount = 0;
        let ownDocCount = 0;
        let borrowedCount = 0;
        let unassignedCount = 0;
        let delayed1782Count = 0;
        const doubleEmptyChanges = [];

        let activePatients = patients.filter(p => {
            const isManual = p.is_manual_assigned || false;
            const rawSt = String(p.raw_status_bed || '').trim();
            const hasRaw = Boolean(rawSt && !rawSt.toLowerCase().includes('delay') && !rawSt.includes('待') && !['-', '無'].includes(rawSt));
            if ((isManual || hasRaw) && p.is_assigned) return false;
            const st = String(p.status_bed || '').trim();
            if ((isManual || hasRaw) && st && !st.toLowerCase().includes('delay') && !st.includes('待') && !['無', '-'].includes(st)) return false;
            return true;
        });

        const totalActivePatientsCount = activePatients.length;
        const assignedChartNos = new Set();
        for (const p of patients) {
            const isManual = p.is_manual_assigned || false;
            const rawSt = String(p.raw_status_bed || '').trim();
            const hasRaw = Boolean(rawSt && !rawSt.toLowerCase().includes('delay') && !rawSt.includes('待') && !['-', '無'].includes(rawSt));
            if ((isManual || hasRaw) && p.is_assigned && p.chart_no) {
                assignedChartNos.add(String(p.chart_no).trim());
            }
        }

        function assignBedToPatient(p, matchedBed, isBorrow, isProxyBorrow, docInfoLog, stageName) {
            const idx = pool.indexOf(matchedBed);
            if (idx !== -1) pool.splice(idx, 1);

            const ward = matchedBed.ward;
            const bNum = matchedBed.bed_num;

            let docId = matchedBed.clean_doc_code;
            if (!docId && matchedBed.doctor_code) docId = String(matchedBed.doctor_code).replace(/\D/g, '');
            if (!docId && matchedBed.doctor_name) docId = nameToCode[matchedBed.doctor_name] || '';
            if (!docId) docId = matchedBed.doctor_name || '';

            let pClean = String(p.doc_code || '').replace(/\D/g, '');
            if (!pClean && p.doctor) pClean = nameToCode[p.doctor] || '';

            let bedProxy = leaveDocToProxy[docId] || leaveDocToProxy[matchedBed.doctor_name];
            if (!bedProxy && matchedBed.proxy_doctor) {
                bedProxy = nameToCode[matchedBed.proxy_doctor] || String(matchedBed.proxy_doctor).replace(/\D/g, '');
            }

            let bedStrAssigned = "";
            if (isProxyBorrow) {
                const proxyCode = pClean || bedProxy || docId;
                bedStrAssigned = `${ward}-${bNum} (${proxyCode})`;
                borrowedCount++;
            } else if (isBorrow) {
                const effectiveCode = bedProxy || docId;
                bedStrAssigned = effectiveCode ? `${ward}-${bNum} (${effectiveCode})` : `${ward}-${bNum}`;
                borrowedCount++;
            } else {
                const pProxy = leaveDocToProxy[pClean] || leaveDocToProxy[p.doctor];
                bedStrAssigned = pProxy ? `${ward}-${bNum} (${pProxy})` : `${ward}-${bNum}`;
                ownDocCount++;
            }

            p.status_bed = bedStrAssigned;
            p.is_assigned = true;
            p.assigned_ward = ward;
            p.assigned_bed = String(bNum);
            assignedCount++;

            const chartNo = String(p.chart_no || '').trim();
            if (chartNo) assignedChartNos.add(chartNo);

            if (matchedBed.category === '雙空' || matchedBed.is_double_empty) {
                const genderVal = p.gender || 'M';
                const genderZh = genderVal === 'M' ? "男" : "女";
                const twinPartner = matchedBed.twin_partner;
                if (twinPartner !== undefined && twinPartner !== null) {
                    let partnerFound = false;
                    for (const otherB of pool) {
                        if (otherB.ward === ward && String(otherB.bed_num) === String(twinPartner)) {
                            otherB.locked_gender = genderVal;
                            otherB.twin_room_status = 'one_used';
                            partnerFound = true;
                        }
                    }
                    if (partnerFound) {
                        logs.push(`[${ward}病房] 雙空床位 ${bNum} 由${genderZh}性病人(${p.name})入住，夥伴床位 ${twinPartner} 自動更新為【已用一床】(鎖定為${genderZh}性專用)！`);
                    }
                }
            }

            let yvNote = "";
            const cDoc = (p.doc_code || '').replace(/\D/g, '');
            if (BedAssignmentEngine.isErEicuPatient(p) && youngVList.includes(cDoc)) {
                yvNote = " [⚡Young V急診優選收治]";
            }

            logs.push(`✓ [${stageName}] 已排入: ${p.name} (${p.gender || 'M'}) -> ${bedStrAssigned} [${matchedBed.category}] | ${docInfoLog}${yvNote}`);
        }

        // 步驟 0: 純他科高級單人房病人 (1(192), 1(119), 1(129))
        const pureVipPatients = [];
        for (const p of activePatients) {
            const normPref = String(p.normalized_pref || '').trim() || this.getNormalizedPreference(p.bed_pref || '');
            const tokens = normPref.split('>').map(t => t.trim());
            const hasVip = ['192', '119', '129'].some(rm => normPref.includes(rm));
            const hasPlainSingle = tokens.includes('1');
            if (hasVip && !hasPlainSingle) {
                let targetVip = '192';
                for (const rm of ['192', '119', '129']) {
                    if (tokens[0] && tokens[0].includes(rm)) {
                        targetVip = rm;
                        break;
                    }
                }
                p.status_bed = targetVip;
                p.is_assigned = true;
                p.assigned_ward = targetVip;
                p.assigned_bed = targetVip;
                assignedCount++;
                if (p.chart_no) assignedChartNos.add(String(p.chart_no).trim());
                logs.push(`ℹ️ [他科借床] 病人 ${p.name} 意願純高級單人房 (${normPref})，標記為 ${targetVip} (他科手動借床)`);
                pureVipPatients.push(p);
            }
        }
        if (pureVipPatients.length > 0) {
            activePatients = activePatients.filter(p => !p.is_assigned);
        }

        // 方案 3 (全域二分圖最大匹配)
        if (strategyMode === 'global_bipartite') {
            logs.push("\n--- 【方案 3：全域二分圖最大匹配最佳化排床】 ---");
            const remPts = activePatients.filter(p => !p.is_assigned);
            if (remPts.length > 0 && pool.length > 0) {
                const matching = this.solveBipartiteMatching(remPts, pool, manager, docHomeWards, proxyToLeaveDocs, youngVList);
                const matchedPairs = [];
                for (const [pIdx, bIdx] of Object.entries(matching)) {
                    matchedPairs.push({ p: remPts[parseInt(pIdx, 10)], b: pool[parseInt(bIdx, 10)] });
                }

                for (const pair of matchedPairs) {
                    const p = pair.p;
                    const matchedBed = pair.b;
                    if (!pool.includes(matchedBed)) continue;

                    const pClean = (p.doc_code || '').replace(/\D/g, '');
                    const isOwn = (matchedBed.clean_doc_code === pClean);
                    const isProxy = (proxyToLeaveDocs[pClean] || []).includes(matchedBed.clean_doc_code);
                    let docInfo = "";
                    if (isProxy) {
                        docInfo = `代理請假醫師床位(${matchedBed.doctor_name})`;
                    } else if (!isOwn) {
                        const hWard = docHomeWards[pClean] || '';
                        docInfo = (hWard && String(matchedBed.ward).replace('A', '') === hWard) ? `同病房借床(${matchedBed.doctor_name})` : `全域借床(${matchedBed.doctor_name})`;
                    } else {
                        docInfo = `主治醫師本床(${matchedBed.doctor_name})`;
                    }

                    assignBedToPatient(p, matchedBed, !isOwn, isProxy, docInfo, "全域二分圖最佳匹配");
                }
            }

            // 處理無法媒合者
            for (const p of activePatients) {
                if (!p.is_assigned) {
                    const normPref = String(p.normalized_pref || '').trim() || this.getNormalizedPreference(p.bed_pref || '');
                    const hasVip = ['192', '119', '129'].some(rm => normPref.includes(rm));
                    if (hasVip) {
                        const fallbackVip = normPref.includes('192') ? '192' : (['119', '129'].find(rm => normPref.includes(rm)) || '192');
                        p.status_bed = fallbackVip;
                        p.is_assigned = true;
                        p.assigned_ward = fallbackVip;
                        p.assigned_bed = fallbackVip;
                        assignedCount++;
                        if (p.chart_no) assignedChartNos.add(String(p.chart_no).trim());
                        logs.push(`⚠️ [他科借床] 病人 ${p.name} 意願 ${normPref} 本院無單人床，轉為他科借床: ${fallbackVip}`);
                    } else {
                        let currDelay = p.initial_delay_days;
                        if (currDelay === undefined || currDelay === null) {
                            currDelay = ExcelPatientParser.extractDelayDays(p.status_bed || '');
                        }
                        const nextDelay = currDelay + 1;
                        p.status_bed = `delay ${nextDelay}`;
                        p.is_assigned = false;
                        unassignedCount++;
                        const pClean = (p.doc_code || '').replace(/\D/g, '');
                        if (pClean === this.DOC_1782) delayed1782Count++;
                        logs.push(`✗ 延後住院 (設為 ${p.status_bed}): ${p.name} (${p.gender}, 燈號:${p.doc_code}) 全院無可用床位`);
                    }
                }
            }

            return {
                total_patients: totalActivePatientsCount,
                assigned_count: assignedCount,
                own_doc_count: ownDocCount,
                borrowed_count: borrowedCount,
                unassigned_count: unassignedCount,
                delayed_1782_count: delayed1782Count,
                double_empty_changes: doubleEmptyChanges,
                remaining_pool_count: pool.length,
                logs
            };
        }

        // 方案 2 (雙空依性別缺額優先排法) 前置
        if (strategyMode === 'upgrade_2_copay' || strategyMode === 'gender_shortage_twin') {
            for (const p of activePatients) {
                const effPref = this.getPatientEffectivePref(p);
                const norm = String(p.normalized_pref || '').trim() || this.getNormalizedPreference(effPref);
                const [crit, allowCo] = this.parsePreference(effPref);
                if (allowCo && (norm.includes('2$') || crit.includes('co_pay_2'))) {
                    p._strat_upgrade_copay = true;
                    if (norm.includes('2>2$')) {
                        p.normalized_pref = norm.replace('2>2$', '2$>2');
                    } else if (!norm.startsWith('2$') && !norm.startsWith('1')) {
                        p.normalized_pref = '2$>2';
                    }
                    logs.push(`💡 [${stratTitle}] 病人 ${p.name} 房型意願調整為自費雙人床優先 (2$>2)`);
                }
            }

            const copayTargetPts = activePatients.filter(p => p._strat_upgrade_copay && !p.is_assigned);
            for (const p of copayTargetPts) {
                const gender = p.gender || 'M';
                const cDoc = (p.doc_code || '').replace(/\D/g, '');
                const availCopay = pool.filter(b =>
                    this.bedMatchesCriterion(b, 'co_pay_2', gender, true) &&
                    (b.clean_doc_code === cDoc || this.canDoctorBorrowBed(cDoc, b))
                );
                if (availCopay.length > 0) {
                    availCopay.sort((a, b) => {
                        const aOwn = a.clean_doc_code === cDoc ? 0 : 1;
                        const bOwn = b.clean_doc_code === cDoc ? 0 : 1;
                        if (aOwn !== bOwn) return aOwn - bOwn;
                        const aOne = (a.category === '雙空' && a.twin_room_status === 'one_used') ? 0 : 1;
                        const bOne = (b.category === '雙空' && b.twin_room_status === 'one_used') ? 0 : 1;
                        if (aOne !== bOne) return aOne - bOne;
                        const aNum = parseInt(a.bed_num, 10) || 9999;
                        const bNum = parseInt(b.bed_num, 10) || 9999;
                        return aNum - bNum;
                    });
                    const matchedBed = availCopay[0];
                    const isOwn = (matchedBed.clean_doc_code === cDoc);
                    const docInfo = isOwn ? `主治醫師自費本床(${matchedBed.doctor_name})` : `借用自費雙人床(${matchedBed.doctor_name})`;
                    assignBedToPatient(p, matchedBed, !isOwn, false, docInfo, "2$>2自費床優先媒合");
                }
            }
        }

        // 方案 2 特有：雙空依性別缺額優先分配
        if (strategyMode === 'gender_shortage_twin') {
            const remMalePts = activePatients.filter(p => p.gender === 'M' && !p.is_assigned);
            const remFemalePts = activePatients.filter(p => p.gender === 'F' && !p.is_assigned);
            const fixedMale = pool.filter(b => ['男2', '男4'].includes(b.category));
            const maleDeficit = Math.max(0, remMalePts.length - fixedMale.length);

            if (maleDeficit > 0 && fixedMale.length === 0) {
                const fDocCodes = new Set(remFemalePts.map(p => (p.doc_code || '').replace(/\D/g, '')));
                const candidateTwinRooms = {};
                for (const b of pool) {
                    if ((b.category === '雙空' || b.is_double_empty) && b.twin_room_status === 'both_empty') {
                        if (!candidateTwinRooms[b.ward]) candidateTwinRooms[b.ward] = [];
                        candidateTwinRooms[b.ward].push(b);
                    }
                }

                let bestWard = null;
                for (const [w, wBeds] of Object.entries(candidateTwinRooms)) {
                    if (wBeds.length >= 2) {
                        const wDocs = new Set(wBeds.map(b => b.clean_doc_code));
                        const hasOverlap = Array.from(wDocs).some(doc => fDocCodes.has(doc));
                        if (!hasOverlap) {
                            bestWard = w;
                            break;
                        }
                    }
                }
                if (!bestWard) {
                    for (const w of Object.keys(candidateTwinRooms)) {
                        if (w !== '123') { bestWard = w; break; }
                    }
                }
                if (!bestWard && Object.keys(candidateTwinRooms).length) {
                    bestWard = Object.keys(candidateTwinRooms)[0];
                }

                if (bestWard && remMalePts.length > 0) {
                    logs.push(`📊 [性別缺額平衡] 偵測到男性缺額 ${maleDeficit} 床，調配 ${bestWard} 病房全空雙空房專供男性入住湊房！`);
                    const wTwinBeds = candidateTwinRooms[bestWard];
                    for (const mPt of remMalePts) {
                        if (!wTwinBeds.length) break;
                        const mCleanDoc = (mPt.doc_code || '').replace(/\D/g, '');
                        const [mCrit, mAllowCo] = this.parsePreference(this.getPatientEffectivePref(mPt));
                        let matchedMBed = null;
                        for (const crit of mCrit) {
                            for (const tb of wTwinBeds) {
                                if (this.bedMatchesCriterion(tb, crit, 'M', mAllowCo)) {
                                    matchedMBed = tb;
                                    break;
                                }
                            }
                            if (matchedMBed) break;
                        }
                        if (matchedMBed) {
                            const tbIdx = wTwinBeds.indexOf(matchedMBed);
                            if (tbIdx !== -1) wTwinBeds.splice(tbIdx, 1);
                            const isOwn = (matchedMBed.clean_doc_code === mCleanDoc);
                            assignBedToPatient(mPt, matchedMBed, !isOwn, false, `雙空性別缺額優先分配(${matchedMBed.doctor_name})`, "雙空依性別缺額優先指派");
                        }
                    }
                }
            }
        }

        const rankOwnBed = (b, homeWard, p = null) => {
            let wardTier = b.ward === homeWard ? 0 : 1;
            if (p && this.has124WardPriority(p)) {
                wardTier = (String(b.ward).replace('A', '') === '124') ? -1 : 0;
            }
            const isTwin = (b.category === '雙空' || b.is_double_empty);
            const twinStatus = isTwin ? (b.twin_room_status || 'both_empty') : null;

            let twinTier = 1;
            if (isTwin && twinStatus === 'one_used') {
                twinTier = 0;
            } else if (strategyMode === 'prioritize_twin' || strategyMode === 'gender_shortage_twin') {
                twinTier = (isTwin && twinStatus === 'both_empty') ? 1 : 2;
            } else {
                twinTier = !isTwin ? 1 : 2;
            }

            const bNumVal = parseInt(b.bed_num, 10) || 9999;
            return [wardTier, twinTier, bNumVal];
        };

        const findOwnBed = (p) => {
            const gender = p.gender || 'M';
            const cleanDocCode = (p.doc_code || '').replace(/\D/g, '');
            if (!cleanDocCode) return null;
            const [orderCriteria, allowCoPay] = this.parsePreference(this.getPatientEffectivePref(p));
            const homeWard = docHomeWards[cleanDocCode] || "";

            let matchedBed = null;
            for (const crit of orderCriteria) {
                const ownBeds = pool.filter(b => b.clean_doc_code === cleanDocCode && this.bedMatchesCriterion(b, crit, gender, allowCoPay));
                if (ownBeds.length > 0) {
                    ownBeds.sort((a, b) => {
                        const ka = rankOwnBed(a, homeWard, p);
                        const kb = rankOwnBed(b, homeWard, p);
                        for (let i = 0; i < ka.length; i++) {
                            if (ka[i] !== kb[i]) return ka[i] - kb[i];
                        }
                        return 0;
                    });
                    matchedBed = ownBeds[0];
                    break;
                }
            }
            return matchedBed;
        };

        const findBorrowBed = (p, isEr = false) => {
            const gender = p.gender || 'M';
            const cleanDocCode = (p.doc_code || '').replace(/\D/g, '');
            const [orderCriteria, allowCoPay] = this.parsePreference(this.getPatientEffectivePref(p));
            const homeWard = docHomeWards[cleanDocCode] || "";
            const proxiedLeaveDocs = proxyToLeaveDocs[cleanDocCode] || [];
            const has124 = this.has124WardPriority(p);

            let matchedBed = null;
            let isProxyBorrow = false;

            // 依病人 prefer 順位依序搜尋床位
            for (const crit of orderCriteria) {
                // 1. 優先在同病房借床 (方便查房原則；若有 124 優先意願，以 124 為優先目標病房)
                let targetWard = has124 ? "124" : homeWard;
                if (targetWard) {
                    const sameWardBeds = pool.filter(b =>
                        String(b.ward).replace('A', '') === targetWard &&
                        b.clean_doc_code !== cleanDocCode &&
                        this.canDoctorBorrowBed(cleanDocCode, b) &&
                        this.bedMatchesCriterion(b, crit, gender, allowCoPay)
                    );
                    if (sameWardBeds.length > 0) {
                        sameWardBeds.sort((a, b) => {
                            const ca = a.clean_doc_code;
                            const cb = b.clean_doc_code;
                            const proxyA = proxiedLeaveDocs.includes(ca) ? 0 : 1;
                            const proxyB = proxiedLeaveDocs.includes(cb) ? 0 : 1;
                            if (proxyA !== proxyB) return proxyA - proxyB;

                            if (cleanDocCode === this.DOC_1782) {
                                const is124A = [this.DOC_1699, this.DOC_1691].includes(ca) ? 0 : 1;
                                const is124B = [this.DOC_1699, this.DOC_1691].includes(cb) ? 0 : 1;
                                if (is124A !== is124B) return is124A - is124B;
                            }

                            if (isEr) {
                                const yvA = youngVList.includes(ca) ? 0 : 1;
                                const yvB = youngVList.includes(cb) ? 0 : 1;
                                if (yvA !== yvB) return yvA - yvB;
                            }

                            const depA = this.RULE3_DEPRIORITIZED_BORROW_DOCS.has(ca) ? 1 : 0;
                            const depB = this.RULE3_DEPRIORITIZED_BORROW_DOCS.has(cb) ? 1 : 0;
                            if (depA !== depB) return depA - depB;

                            const oneA = (a.category === '雙空' && a.twin_room_status === 'one_used') ? 0 : 1;
                            const oneB = (b.category === '雙空' && b.twin_room_status === 'one_used') ? 0 : 1;
                            if (oneA !== oneB) return oneA - oneB;

                            return (parseInt(a.bed_num, 10) || 9999) - (parseInt(b.bed_num, 10) || 9999);
                        });
                        matchedBed = sameWardBeds[0];
                        isProxyBorrow = proxiedLeaveDocs.includes(matchedBed.clean_doc_code);
                        break;
                    }
                }

                // 若有 124 優先但在 124 沒借到同房床，檢查原所屬病房
                if (!matchedBed && has124 && homeWard && homeWard !== "124") {
                    const homeBeds = pool.filter(b =>
                        String(b.ward).replace('A', '') === homeWard &&
                        b.clean_doc_code !== cleanDocCode &&
                        this.canDoctorBorrowBed(cleanDocCode, b) &&
                        this.bedMatchesCriterion(b, crit, gender, allowCoPay)
                    );
                    if (homeBeds.length > 0) {
                        homeBeds.sort((a, b) => {
                            const ca = a.clean_doc_code;
                            const cb = b.clean_doc_code;
                            const proxyA = proxiedLeaveDocs.includes(ca) ? 0 : 1;
                            const proxyB = proxiedLeaveDocs.includes(cb) ? 0 : 1;
                            if (proxyA !== proxyB) return proxyA - proxyB;
                            if (cleanDocCode === this.DOC_1782) {
                                const is124A = [this.DOC_1699, this.DOC_1691].includes(ca) ? 0 : 1;
                                const is124B = [this.DOC_1699, this.DOC_1691].includes(cb) ? 0 : 1;
                                if (is124A !== is124B) return is124A - is124B;
                            }
                            if (isEr) {
                                const yvA = youngVList.includes(ca) ? 0 : 1;
                                const yvB = youngVList.includes(cb) ? 0 : 1;
                                if (yvA !== yvB) return yvA - yvB;
                            }
                            const depA = this.RULE3_DEPRIORITIZED_BORROW_DOCS.has(ca) ? 1 : 0;
                            const depB = this.RULE3_DEPRIORITIZED_BORROW_DOCS.has(cb) ? 1 : 0;
                            if (depA !== depB) return depA - depB;
                            const oneA = (a.category === '雙空' && a.twin_room_status === 'one_used') ? 0 : 1;
                            const oneB = (b.category === '雙空' && b.twin_room_status === 'one_used') ? 0 : 1;
                            if (oneA !== oneB) return oneA - oneB;
                            return (parseInt(a.bed_num, 10) || 9999) - (parseInt(b.bed_num, 10) || 9999);
                        });
                        matchedBed = homeBeds[0];
                        isProxyBorrow = proxiedLeaveDocs.includes(matchedBed.clean_doc_code);
                        break;
                    }
                }

                // 2. 若同病房無合適床，跨病房借此房型 (crit)
                if (!matchedBed) {
                    const crossBeds = pool.filter(b =>
                        b.clean_doc_code !== cleanDocCode &&
                        this.canDoctorBorrowBed(cleanDocCode, b) &&
                        this.bedMatchesCriterion(b, crit, gender, allowCoPay)
                    );
                    if (crossBeds.length > 0) {
                        crossBeds.sort((a, b) => {
                            if (has124) {
                                const is124A = String(a.ward).replace('A', '') === '124' ? 0 : 1;
                                const is124B = String(b.ward).replace('A', '') === '124' ? 0 : 1;
                                if (is124A !== is124B) return is124A - is124B;
                            }
                            const ca = a.clean_doc_code;
                            const cb = b.clean_doc_code;
                            const proxyA = proxiedLeaveDocs.includes(ca) ? 0 : 1;
                            const proxyB = proxiedLeaveDocs.includes(cb) ? 0 : 1;
                            if (proxyA !== proxyB) return proxyA - proxyB;

                            if (cleanDocCode === this.DOC_1782) {
                                const is124A = ([this.DOC_1699, this.DOC_1691].includes(ca) && String(a.ward).replace('A', '') === '124') ? 0 : 1;
                                const is124B = ([this.DOC_1699, this.DOC_1691].includes(cb) && String(b.ward).replace('A', '') === '124') ? 0 : 1;
                                if (is124A !== is124B) return is124A - is124B;
                            }

                            if (isEr) {
                                const yvA = youngVList.includes(ca) ? 0 : 1;
                                const yvB = youngVList.includes(cb) ? 0 : 1;
                                if (yvA !== yvB) return yvA - yvB;
                            }

                            const depA = this.RULE3_DEPRIORITIZED_BORROW_DOCS.has(ca) ? 1 : 0;
                            const depB = this.RULE3_DEPRIORITIZED_BORROW_DOCS.has(cb) ? 1 : 0;
                            if (depA !== depB) return depA - depB;

                            const oneA = (a.category === '雙空' && a.twin_room_status === 'one_used') ? 0 : 1;
                            const oneB = (b.category === '雙空' && b.twin_room_status === 'one_used') ? 0 : 1;
                            if (oneA !== oneB) return oneA - oneB;

                            return (parseInt(a.bed_num, 10) || 9999) - (parseInt(b.bed_num, 10) || 9999);
                        });
                        matchedBed = crossBeds[0];
                        isProxyBorrow = proxiedLeaveDocs.includes(matchedBed.clean_doc_code);
                        break;
                    }
                }
            }

            return { matchedBed, isProxyBorrow };
        };

        // 分組三類基本病人群 (互斥集合)
        const onTimePatients = multiKeySort(activePatients.filter(isPriorityArrival), tierSortKey);
        const erPatients = multiKeySort(activePatients.filter(p => !isPriorityArrival(p) && this.isErEicuPatient(p)), tierSortKey);
        const otherPatients = multiKeySort(activePatients.filter(p => !isPriorityArrival(p) && !this.isErEicuPatient(p)), tierSortKey);

        // =========================================================================
        // 【位階 1】先找準時病人剛好主治醫師有他對應床位的 (delay多的先排，同delay隨機)
        // =========================================================================
        logs.push(`\n--- 【位階 1】準時病人配對主治醫師本床 (共 ${onTimePatients.length} 位) ---`);
        for (const p of onTimePatients) {
            if (p.is_assigned) continue;
            const chartNo = String(p.chart_no || '').trim();
            if (chartNo && assignedChartNos.has(chartNo)) {
                p.status_bed = "重覆名單 (已排床)";
                p.is_assigned = false;
                continue;
            }
            const matchedBed = findOwnBed(p);
            if (matchedBed) {
                assignBedToPatient(p, matchedBed, false, false, `主治醫師本床(${matchedBed.doctor_name})`, "位階1-準時病人本床");
            }
        }

        // =========================================================================
        // 【位階 2】ER或EICU有剛好主治醫師有他對應床位的 (delay多的先排，同delay隨機)
        // =========================================================================
        logs.push(`\n--- 【位階 2】ER/EICU病人配對主治醫師本床 (共 ${erPatients.length} 位) ---`);
        for (const p of erPatients) {
            if (p.is_assigned) continue;
            const chartNo = String(p.chart_no || '').trim();
            if (chartNo && assignedChartNos.has(chartNo)) {
                p.status_bed = "重覆名單 (已排床)";
                p.is_assigned = false;
                continue;
            }
            const matchedBed = findOwnBed(p);
            if (matchedBed) {
                assignBedToPatient(p, matchedBed, false, false, `主治醫師本床(${matchedBed.doctor_name})`, "位階2-ER/EICU病人本床");
            }
        }

        // =========================================================================
        // 【位階 3】其他病人主治醫師剛好有自己病人的床位的 (delay多的先排，同delay隨機)
        // =========================================================================
        logs.push(`\n--- 【位階 3】其他病人配對主治醫師本床 (共 ${otherPatients.length} 位) ---`);
        for (const p of otherPatients) {
            if (p.is_assigned) continue;
            const chartNo = String(p.chart_no || '').trim();
            if (chartNo && assignedChartNos.has(chartNo)) {
                p.status_bed = "重覆名單 (已排床)";
                p.is_assigned = false;
                continue;
            }
            const matchedBed = findOwnBed(p);
            if (matchedBed) {
                assignBedToPatient(p, matchedBed, false, false, `主治醫師本床(${matchedBed.doctor_name})`, "位階3-其他病人本床");
            }
        }

        // =========================================================================
        // 方案 4: 本床排定後，依位階 4 -> 5 -> 6 進行全域二分圖最佳借床
        // =========================================================================
        if (strategyMode === 'bipartite_after_step2') {
            logs.push("\n--- 【方案 4：本床後全域二分圖最佳借床 (位階 4 -> 位階 5 -> 位階 6)】 ---");
            const stages = [
                { list: onTimePatients.filter(p => !p.is_assigned), name: "位階4-準時借床(二分圖)" },
                { list: erPatients.filter(p => !p.is_assigned), name: "位階5-ER/EICU借床(二分圖)" },
                { list: otherPatients.filter(p => !p.is_assigned), name: "位階6-其他病人借床(二分圖)" }
            ];

            for (const stg of stages) {
                if (stg.list.length > 0 && pool.length > 0) {
                    const matching = this.solveBipartiteMatching(stg.list, pool, manager, docHomeWards, proxyToLeaveDocs, youngVList);
                    const matchedPairs = [];
                    for (const [pIdx, bIdx] of Object.entries(matching)) {
                        matchedPairs.push({ p: stg.list[parseInt(pIdx, 10)], b: pool[parseInt(bIdx, 10)] });
                    }
                    for (const pair of matchedPairs) {
                        const p = pair.p;
                        const matchedBed = pair.b;
                        if (!pool.includes(matchedBed)) continue;

                        const pClean = (p.doc_code || '').replace(/\D/g, '');
                        const isOwn = (matchedBed.clean_doc_code === pClean);
                        const isProxy = (proxyToLeaveDocs[pClean] || []).includes(matchedBed.clean_doc_code);
                        let docInfo = "";
                        if (isProxy) {
                            docInfo = `代理請假醫師床位(${matchedBed.doctor_name})`;
                        } else if (!isOwn) {
                            const hWard = docHomeWards[pClean] || '';
                            docInfo = (hWard && String(matchedBed.ward).replace('A', '') === hWard) ? `同病房借床(${matchedBed.doctor_name})` : `全域借床(${matchedBed.doctor_name})`;
                        } else {
                            docInfo = `主治醫師本床(${matchedBed.doctor_name})`;
                        }

                        assignBedToPatient(p, matchedBed, !isOwn, isProxy, docInfo, stg.name);
                    }
                }
            }

            for (const p of activePatients) {
                if (!p.is_assigned) {
                    const normPref = String(p.normalized_pref || '').trim() || this.getNormalizedPreference(p.bed_pref || '');
                    const hasVip = ['192', '119', '129'].some(rm => normPref.includes(rm));
                    if (hasVip) {
                        const fallbackVip = normPref.includes('192') ? '192' : (['119', '129'].find(rm => normPref.includes(rm)) || '192');
                        p.status_bed = fallbackVip;
                        p.is_assigned = true;
                        p.assigned_ward = fallbackVip;
                        p.assigned_bed = fallbackVip;
                        assignedCount++;
                        if (p.chart_no) assignedChartNos.add(String(p.chart_no).trim());
                        logs.push(`⚠️ [他科借床] 病人 ${p.name} 意願 ${normPref} 本院無單人床，轉為他科借床: ${fallbackVip}`);
                    } else {
                        let currDelay = p.initial_delay_days;
                        if (currDelay === undefined || currDelay === null) {
                            currDelay = ExcelPatientParser.extractDelayDays(p.status_bed || '');
                        }
                        const nextDelay = currDelay + 1;
                        p.status_bed = `delay ${nextDelay}`;
                        p.is_assigned = false;
                        unassignedCount++;
                        const pClean = (p.doc_code || '').replace(/\D/g, '');
                        if (pClean === this.DOC_1782) delayed1782Count++;
                        logs.push(`✗ 延後住院 (設為 ${p.status_bed}): ${p.name} (${p.gender || 'M'}, 燈號:${p.doc_code}) 全院無可用床位`);
                    }
                }
            }

            return {
                total_patients: totalActivePatientsCount,
                assigned_count: assignedCount,
                own_doc_count: ownDocCount,
                borrowed_count: borrowedCount,
                unassigned_count: unassignedCount,
                delayed_1782_count: delayed1782Count,
                double_empty_changes: doubleEmptyChanges,
                remaining_pool_count: pool.length,
                logs
            };
        }

        // =========================================================================
        // 【位階 4】準時但主治醫師沒有剛好他的床位的 (借床)
        // =========================================================================
        const stage4Unassigned = multiKeySort(onTimePatients.filter(p => !p.is_assigned), tierSortKey);
        logs.push(`\n--- 【位階 4】準時但主治醫師無本床病人向其他醫師借床 (共 ${stage4Unassigned.length} 位) ---`);
        for (const p of stage4Unassigned) {
            if (p.is_assigned) continue;
            const chartNo = String(p.chart_no || '').trim();
            if (chartNo && assignedChartNos.has(chartNo)) continue;

            const { matchedBed, isProxyBorrow } = findBorrowBed(p, false);
            if (matchedBed) {
                const shortNote = this.isShortStayPatient(p) ? " [⏱️短天數住院，適合借床]" : "";
                const cleanDocCode = (p.doc_code || '').replace(/\D/g, '');
                const homeWard = docHomeWards[cleanDocCode] || "";
                const docInfo = isProxyBorrow
                    ? `代理請假醫師床位(${matchedBed.doctor_name})${shortNote}`
                    : (homeWard && matchedBed.ward === homeWard ? `同病房借床(${matchedBed.doctor_name})${shortNote}` : `跨病房借床(${matchedBed.doctor_name})${shortNote}`);
                assignBedToPatient(p, matchedBed, true, isProxyBorrow, docInfo, "位階4-準時病人借床");
            }
        }

        // =========================================================================
        // 【位階 5】ER或EICU主治醫師沒有剛好他的床位的 (借床)
        // =========================================================================
        const stage5Unassigned = multiKeySort(erPatients.filter(p => !p.is_assigned), tierSortKey);
        logs.push(`\n--- 【位階 5】ER/EICU 主治醫師無本床病人向其他醫師借床 (共 ${stage5Unassigned.length} 位) ---`);
        for (const p of stage5Unassigned) {
            if (p.is_assigned) continue;
            const chartNo = String(p.chart_no || '').trim();
            if (chartNo && assignedChartNos.has(chartNo)) continue;

            const { matchedBed, isProxyBorrow } = findBorrowBed(p, true);
            if (matchedBed) {
                const shortNote = this.isShortStayPatient(p) ? " [⏱️短天數住院，適合借床]" : "";
                const cleanDocCode = (p.doc_code || '').replace(/\D/g, '');
                const homeWard = docHomeWards[cleanDocCode] || "";
                const docInfo = isProxyBorrow
                    ? `代理請假醫師床位(${matchedBed.doctor_name})${shortNote}`
                    : (homeWard && matchedBed.ward === homeWard ? `同病房借床(${matchedBed.doctor_name})${shortNote}` : `跨病房借床(${matchedBed.doctor_name})${shortNote}`);
                assignBedToPatient(p, matchedBed, true, isProxyBorrow, docInfo, "位階5-ER/EICU借床");
            }
        }

        // =========================================================================
        // 【位階 6】剩下的病人主治醫師沒有剛好他的床位的 (借床)
        // =========================================================================
        const stage6Unassigned = multiKeySort(otherPatients.filter(p => !p.is_assigned), tierSortKey);
        logs.push(`\n--- 【位階 6】剩餘病人主治醫師無本床向其他醫師借床 (共 ${stage6Unassigned.length} 位) ---`);
        for (const p of stage6Unassigned) {
            if (p.is_assigned) continue;
            const chartNo = String(p.chart_no || '').trim();
            if (chartNo && assignedChartNos.has(chartNo)) continue;

            const { matchedBed, isProxyBorrow } = findBorrowBed(p, false);
            if (matchedBed) {
                const shortNote = this.isShortStayPatient(p) ? " [⏱️短天數住院，適合借床]" : "";
                const cleanDocCode = (p.doc_code || '').replace(/\D/g, '');
                const homeWard = docHomeWards[cleanDocCode] || "";
                const docInfo = isProxyBorrow
                    ? `代理請假醫師床位(${matchedBed.doctor_name})${shortNote}`
                    : (homeWard && matchedBed.ward === homeWard ? `同病房借床(${matchedBed.doctor_name})${shortNote}` : `跨病房借床(${matchedBed.doctor_name})${shortNote}`);
                assignBedToPatient(p, matchedBed, true, isProxyBorrow, docInfo, "位階6-剩餘病人借床");
            }
        }

        // 處理未排定者 (VIP 或 標記 delay)
        for (const p of activePatients) {
            if (!p.is_assigned) {
                const normPref = String(p.normalized_pref || '').trim() || this.getNormalizedPreference(p.bed_pref || '');
                const hasVip = ['192', '119', '129'].some(rm => normPref.includes(rm));
                if (hasVip) {
                    const fallbackVip = normPref.includes('192') ? '192' : (['119', '129'].find(rm => normPref.includes(rm)) || '192');
                    p.status_bed = fallbackVip;
                    p.is_assigned = true;
                    p.assigned_ward = fallbackVip;
                    p.assigned_bed = fallbackVip;
                    assignedCount++;
                    if (p.chart_no) assignedChartNos.add(String(p.chart_no).trim());
                    logs.push(`⚠️ [他科借床] 病人 ${p.name} 意願 ${normPref} 本院無單人床，轉為他科借床: ${fallbackVip}`);
                } else {
                    let currDelay = p.initial_delay_days;
                    if (currDelay === undefined || currDelay === null) {
                        currDelay = ExcelPatientParser.extractDelayDays(p.status_bed || '');
                    }
                    const nextDelay = currDelay + 1;
                    p.status_bed = `delay ${nextDelay}`;
                    p.is_assigned = false;
                    unassignedCount++;
                    const cleanDocCode = (p.doc_code || '').replace(/\D/g, '');
                    if (cleanDocCode === this.DOC_1782) delayed1782Count++;
                    logs.push(`✗ 延後住院 (設為 ${p.status_bed}): ${p.name} (${p.gender || 'M'}, 燈號:${p.doc_code}) 全院無可用床位`);
                }
            }
        }

        return {
            total_patients: totalActivePatientsCount,
            assigned_count: assignedCount,
            own_doc_count: ownDocCount,
            borrowed_count: borrowedCount,
            unassigned_count: unassignedCount,
            delayed_1782_count: delayed1782Count,
            double_empty_changes: doubleEmptyChanges,
            remaining_pool_count: pool.length,
            logs
        };
    }

    static autoAssign(patients, availableBeds, manager) {
        for (const p of patients) {
            if (p._rand_tie === undefined || p._rand_tie === null) {
                p._rand_tie = Math.random();
            }
        }
        const patientsA = JSON.parse(JSON.stringify(patients));
        const patientsB = JSON.parse(JSON.stringify(patients));
        const bedsA = JSON.parse(JSON.stringify(availableBeds));
        const bedsB = JSON.parse(JSON.stringify(availableBeds));

        const repA = this._simulateAssignment(patientsA, bedsA, manager, 'preserve_twin');
        const repB = this._simulateAssignment(patientsB, bedsB, manager, 'prioritize_twin');

        const assignedA = repA.assigned_count;
        const assignedB = repB.assigned_count;
        const ownA = repA.own_doc_count;
        const ownB = repB.own_doc_count;

        const ratioA = assignedA > 0 ? (ownA / assignedA) : 0.0;
        const ratioB = assignedB > 0 ? (ownB / assignedB) : 0.0;

        let winB = false;
        if (ratioB > ratioA + 1e-6) {
            winB = true;
        } else if (Math.abs(ratioB - ratioA) <= 1e-6) {
            if (ownB > ownA) {
                winB = true;
            } else if (ownB === ownA && assignedB > assignedA) {
                winB = true;
            }
        }

        let winnerReport = winB ? repB : repA;
        let winnerPatients = winB ? patientsB : patientsA;
        let winnerName = winB ? "策略 B (先分配雙空)" : "策略 A (先保留雙空)";
        let winnerRatio = winB ? ratioB : ratioA;

        for (let i = 0; i < patients.length; i++) {
            Object.assign(patients[i], winnerPatients[i]);
        }

        const banner = [
            "================================================================",
            "📊【雙策略模擬比對結果】",
            `• 策略 A (先保留雙空)：排定 ${assignedA} 床 | 本床率: ${(ratioA * 100).toFixed(1)}% (${ownA}/${assignedA}) | 借床: ${repA.borrowed_count} | 待排: ${repA.unassigned_count}`,
            `• 策略 B (先分配雙空)：排定 ${assignedB} 床 | 本床率: ${(ratioB * 100).toFixed(1)}% (${ownB}/${assignedB}) | 借床: ${repB.borrowed_count} | 待排: ${repB.unassigned_count}`,
            `🏆 依本床佔比最高原則，最終採用：【${winnerName}】(本床率: ${(winnerRatio * 100).toFixed(1)}%)`,
            "================================================================"
        ];
        winnerReport.logs = banner.concat(winnerReport.logs);
        winnerReport.winner_strategy = winnerName;
        winnerReport.strategy_comparison = {
            strategy_a: { assigned: assignedA, own: ownA, ratio: ratioA, borrowed: repA.borrowed_count },
            strategy_b: { assigned: assignedB, own: ownB, ratio: ratioB, borrowed: repB.borrowed_count },
            winner: winnerName
        };
        return winnerReport;
    }

    static generateFourStrategies(patients, availableBeds, manager) {
        for (const p of patients) {
            p._rand_tie = Math.random();
            if (!p.doctor_name && manager && typeof manager.lookupDoctorByCode === 'function') {
                const doc = manager.lookupDoctorByCode(p.doc_code || '');
                if (doc && doc.name) p.doctor_name = doc.name;
            }
        }

        // 方案 1: 原本排法 (基準)
        const pts1 = JSON.parse(JSON.stringify(patients));
        const beds1 = JSON.parse(JSON.stringify(availableBeds));
        const rep1 = this.autoAssign(pts1, beds1, manager);

        // 方案 2: 雙空依性別缺額優先排法
        const pts2 = JSON.parse(JSON.stringify(patients));
        const beds2 = JSON.parse(JSON.stringify(availableBeds));
        const rep2 = this._simulateAssignment(pts2, beds2, manager, 'gender_shortage_twin');

        // 方案 3: 全域二分圖最大匹配
        const pts3 = JSON.parse(JSON.stringify(patients));
        const beds3 = JSON.parse(JSON.stringify(availableBeds));
        const rep3 = this._simulateAssignment(pts3, beds3, manager, 'global_bipartite');

        // 方案 4: 步驟 2 本床後全域二分圖匹配
        const pts4 = JSON.parse(JSON.stringify(patients));
        const beds4 = JSON.parse(JSON.stringify(availableBeds));
        const rep4 = this._simulateAssignment(pts4, beds4, manager, 'bipartite_after_step2');

        return {
            original: {
                key: 'original',
                name: '方案 1 (原本排法/基準)',
                badge: '基準方案',
                description: '維持原始輸入意願，採現行常規本床優先與雙空比對機制。',
                report: rep1,
                patients: pts1
            },
            gender_shortage_twin: {
                key: 'gender_shortage_twin',
                name: '方案 2 (雙空依性別缺額優先排法)',
                badge: '🌟 推薦方案 (0 Delay)',
                description: '依全院男女缺額動態調配雙空房，將 2>2$ 改成 2$>2 優先媒合自費雙人床，達成 0 延後！',
                report: rep2,
                patients: pts2
            },
            global_bipartite: {
                key: 'global_bipartite',
                name: '方案 3 (全域二分圖最大匹配)',
                badge: '🚀 極限最佳化 (0 Delay)',
                description: '以二分圖最大匹配與雙空性別回溯為核心，全域考量全院床位與病患限制，極大化簽床人數。',
                report: rep3,
                patients: pts3
            },
            bipartite_after_step2: {
                key: 'bipartite_after_step2',
                name: '方案 4 (步驟2本床後全域二分圖匹配)',
                badge: '⚖️ 兼顧本床與0 Delay',
                description: '步驟2前先保障主治醫師本床優先權，剩餘待排病人與空床再透過二分圖最佳流求解借床。',
                report: rep4,
                patients: pts4
            }
        };
    }

    static generateThreeStrategies(patients, availableBeds, manager) {
        return this.generateFourStrategies(patients, availableBeds, manager);
    }

    static generate_three_strategies(patients, availableBeds, manager) {
        return this.generateFourStrategies(patients, availableBeds, manager);
    }

    static generate_all_strategies(patients, availableBeds, manager) {
        return this.generateFourStrategies(patients, availableBeds, manager);
    }
}

class AIPromptGenerator {
    static cleanPatientForExport(p, orderIdx) {
        const cCode = String(p.doc_code || '').replace(/\D/g, '');
        const rawPref = p.bed_pref || '';
        const userNorm = String(p.normalized_pref || '').trim();
        const normPref = userNorm || BedAssignmentEngine.getNormalizedPreference(rawPref);
        const diag = String(p.diagnosis || '').trim();
        const arrival = String(p.arrival || '').trim();
        const contact = String(p.contact || '').trim();
        const otherNotes = [p.cond, p.protocol, p.note].filter(Boolean).join(' ').trim();

        const isEr = BedAssignmentEngine.isErEicuPatient(p);
        const isUrgent = arrival.includes('準時');
        const isShortStay = BedAssignmentEngine.isShortStayPatient(p);
        const hasDoc = Boolean(cCode && !['都可', '無主', '無', '0'].includes(cCode));

        let initDelay = p.initial_delay_days;
        if (initDelay === undefined || initDelay === null) {
            initDelay = ExcelPatientParser.extractDelayDays(p.status_bed || '');
        }

        const tokens = normPref.split('>').map(t => t.trim());
        const hasVip = ['192', '119', '129'].some(rm => normPref.includes(rm));
        const hasPlainSingle = tokens.includes('1');
        let vipDesc = "常規房型";
        if (hasVip && !hasPlainSingle) {
            vipDesc = "純他科借床 (不佔本院床位，狀態直接寫 192/119/129，不列入 delay)";
        } else if (hasVip && hasPlainSingle) {
            vipDesc = "本院單人候補他科 (優先排本院單人床，全院無單人床時轉 192 他科手動借床，不列入 delay)";
        }

        const erDesc = (isEr && hasDoc) ? "急診有主治 (位階1.5，優先於普通未準時病人)" : (isEr ? "急診無主治 (位階2，同普通未準時病人)" : "常規非急診");

        const isManual = p.is_manual_assigned || false;
        const rawSt = String(p.raw_status_bed || '').trim();
        const hasRawBed = Boolean(rawSt && !rawSt.toLowerCase().includes('delay') && !rawSt.includes('待') && !['-', '無'].includes(rawSt));
        let currStatus = "待排";
        if (isManual) {
            currStatus = p.status_bed || "手動已排";
        } else if (hasRawBed) {
            currStatus = rawSt;
        } else if (rawSt.toLowerCase().includes('delay')) {
            currStatus = rawSt;
        }

        return {
            order: orderIdx,
            chart_no: String(p.chart_no || '').trim(),
            gender: p.gender || 'M',
            doc_code: cCode || String(p.doc_code || '').trim(),
            doc_name: p.doctor || p.doctor_name || "",
            has_assigned_doctor: hasDoc,
            bed_pref_raw: rawPref,
            bed_pref_normalized: normPref,
            vip_room_intent: vipDesc,
            diagnosis: diag,
            arrival_notice: arrival,
            is_urgent_arrival: isUrgent,
            initial_delay_days: initDelay,
            is_delayed_patient: initDelay > 0,
            is_er_patient: isEr,
            er_priority_desc: erDesc,
            is_short_stay: isShortStay,
            short_stay_desc: isShortStay ? "短天數住院 (一日/2天1夜/3天2夜，適合借床)" : "常規住院",
            contact_info: contact,
            notes: otherNotes || "",
            current_status: currStatus
        };
    }

    static generatePrompt(manager, availableBeds, patients) {
        const youngVCodes = (manager && typeof manager.getYoungVList === 'function') ? manager.getYoungVList() : [];
        const youngVNames = (manager && typeof manager.getYoungVNames === 'function') ? manager.getYoungVNames() : "";
        let youngVDisplay = "尚未特別指定（可由使用者在系統輸入燈號）";
        if (youngVNames) {
            youngVDisplay = `${youngVNames}（燈號: ${youngVCodes.join(', ')}）`;
        }

        // 整理各病房主治醫師與主要所屬病房對照
        const wardDocMapping = {};
        if (manager && manager.data && manager.data.wards) {
            for (const [wKey, wVal] of Object.entries(manager.data.wards)) {
                const normW = wKey.replace('A', '');
                const docStrs = [];
                for (const doc of (wVal.doctors || [])) {
                    const c = (doc.code || '').replace(/\D/g, '');
                    docStrs.push(`${doc.name}(${c}) [配床:${doc.bed_str || ''}]`);
                }
                wardDocMapping[`${normW}病房`] = docStrs;
            }
        }

        // 整理請假資訊
        const leaves = (manager && manager.data && manager.data.leaves) ? manager.data.leaves : [];
        const leavesDisplay = leaves.length ? leaves.map(l => `- ${l.raw || `${l.doctor} 請假 (${l.period})，由 ${l.proxy} 代理`}`).join('\n') : "目前無醫師請假登記";

        // 排除已被輸入名單中預先指定之病人佔用之床位 (僅限使用者手動指定或原始Excel既有床位，排除前次演算法排床結果)
        const preoccupiedBeds = new Set();
        for (const p of patients) {
            const isManual = p.is_manual_assigned || false;
            const rawSt = String(p.raw_status_bed || '').trim();
            const hasRaw = Boolean(rawSt && !rawSt.toLowerCase().includes('delay') && !rawSt.includes('待') && !['-', '無'].includes(rawSt));
            if (!(isManual || hasRaw)) continue;

            let w = String(p.assigned_ward || '').trim().replace('A', '');
            let b = String(p.assigned_bed || '').trim();
            if (!w || !b) {
                const parsed = typeof ExcelPatientParser !== 'undefined' ? ExcelPatientParser.parsePreassignedBed(p.status_bed || '') : null;
                if (parsed) {
                    w = parsed.ward || (parsed[0] ? String(parsed[0]).replace('A', '') : '');
                    b = parsed.bedNum || (parsed[1] ? String(parsed[1]) : '');
                }
            }
            if (w && b && !['192', '119', '129'].includes(w)) {
                const bClean = /^\d+$/.test(b) ? String(parseInt(b, 10)) : b;
                preoccupiedBeds.add(`${w}_${bClean}`);
            }
        }

        const filteredBeds = availableBeds.filter(b => {
            const w = String(b.ward || '').replace('A', '');
            const bNum = /^\d+$/.test(b.bed_num) ? String(parseInt(b.bed_num, 10)) : String(b.bed_num || '');
            return !preoccupiedBeds.has(`${w}_${bNum}`);
        });

        // 準備空床清單 JSON
        const bedsJsonData = filteredBeds.map(b => ({
            ward: b.ward || '',
            bed_num: b.bed_num || 0,
            category: b.category || '',
            doctor_name: b.doctor_name || '未指定',
            doctor_code: b.clean_doc_code || (b.doctor_code || '').replace(/\D/g, ''),
            is_co_pay: b.is_co_pay || false,
            is_isolation: b.is_isolation || false,
            bed_type: b.bed_type || '健保床'
        }));

        // 準備去姓名之待簽病人需求清單 (嚴格維持原始順序)
        const patientsJsonData = patients.map((p, idx) => {
            if (!p.doctor && manager && typeof manager.lookupDoctorByCode === 'function') {
                const docObj = manager.lookupDoctorByCode(p.doc_code || '');
                if (docObj) p.doctor = docObj.name;
            }
            return this.cleanPatientForExport(p, idx + 1);
        });

        const bedsJsonStr = JSON.stringify(bedsJsonData, null, 2);
        const patientsJsonStr = JSON.stringify(patientsJsonData, null, 2);
        const wardDocJsonStr = JSON.stringify(wardDocMapping, null, 2);

        const prompt = `你是一位嚴格遵循院內標準簽床作業程序（SOP）的【智慧病房簽床分配專家】。
你的核心任務是為今日入院名單執行【方案 1 (原本排法/基準)】的病床簽床分配建議！
請完全依照下方說明的【方案 1 (原本排法/基準)】核心規則與執行步驟進行運算，輸出之排床建議必須與系統【方案 1 (原本排法/基準)】的結果 100% 完全一致。

=======================================================
【方案 1 (原本排法/基準) 核心定位與重要執行原則】
=======================================================
1. 方案 1 為院內簽床之「基準方案」，核心目標是：
   - 嚴格保障主治醫師專屬本床優先權；
   - 嚴格維護病人原始輸入之房型意願順序（例如 2>2$ 必須嚴格保持健保優先 2>2$，絕不可調升為差額優先 2$>2，僅榮民預設為 2$>2）；
   - 依同病房集中照護與主病房借床順序逐步排床，不使用全域二分圖打破專屬床順序；
   - 雙空房維持原始規則開房與鎖定，不依男女缺額動態調配雙空性別（該調配屬方案 2/3）；
   - 必須完全依循【步驟 0 -> 步驟 1 -> 步驟 1.5 -> 步驟 2 -> 步驟 3 -> 步驟 4】之固定階段單向依序執行！

=======================================================
【輸出樣式與排序核心規範】（極為重要，請務必嚴格遵循）
=======================================================
1. 輸出順序要求：
   必須嚴格按照輸入病人資料 (patients) 的【原始排列順序】(Patient order 1 至 Patient order ${patientsJsonData.length}) 依序輸出，不可隨意調換、重新分組或遺漏任何一位病人！

2. 輸出格式要求：
   請第一步先輸出完整的標準 JSON 格式排床結果陣列，格式規範如下：
   \`\`\`json
   [
     {
       "order": 1,
       "chart_no": "病歷號",
       "assigned_ward": "124",
       "assigned_bed": "21",
       "room_type": "自費單人床",
       "is_borrowed": false,
       "bed_doctor": "床位所屬醫師姓名",
       "status": "已排床",
       "reason": "決策說明：符合第1志願單人床，且為主治醫師專屬床位"
     },
     {
       "order": 2,
       "chart_no": "病歷號",
       "assigned_ward": "192",
       "assigned_bed": "192",
       "room_type": "他科高級單人房",
       "is_borrowed": true,
       "bed_doctor": "他科借床",
       "status": "192",
       "reason": "符合他科高級單人房意願，不佔用本院 113~124 空床，視同向他科手動借床，不列入 delay"
     },
     ...
   ]
   \`\`\`
   若該位病人因為當日無符合意願或條件之床位而無法排床，請填寫：
   \`"assigned_ward": "", "assigned_bed": "", "room_type": "", "is_borrowed": false, "bed_doctor": "", "status": "delay N (若原無delay則設為delay 1，若原本為delay 1則累加為delay 2，依此類推)", "reason": "說明原因 (如當日無符合意願或性別之可用空床)"\`

3. 在 JSON 陣列下方，請附上對齊易讀的 Markdown 彙總表格，包含欄位：
   \`順序 | 病歷號 | 原主治醫師 | 狀態/床位 | 房型類別 | 借床註記 | 排床狀態與理由\`
   ⚠️【借床數字燈號格式規範】：在「狀態/床位」或「借床註記」欄位中，若為借床（包含同病房借床、跨病房借床或代理借床），請務必寫【數字燈號而非名字】，格式如 \`121-25 (5383)\` 或 \`124-2 (1691)\`；如有代班情況請填入代班主治醫師燈號（如 \`121-25 (6410)\`），【嚴禁包含「借床-」或「代理借床-」字眼，亦切勿填寫醫師中文姓名】！

4. 表格以外額外整理【只有病床跟 delay 的純文字 \`\`\`text 區塊】（方便單獨複製整個床位 column 貼上 Excel）：
   在上述彙總表格下方，請額外整理一個只有病床跟 delay 的獨立 \`\`\`text 程式碼區塊，裡面【僅包含分好床位的病床號或 delay】，每位病人一行，完全按照輸入病人順序（第 1 位到第 ${patientsJsonData.length} 位），不要有任何標題、序號或多餘文字：
   範例格式：
   \`\`\`text
   121-25
   124-3
   121-25 (5383)
   delay 1
   124-2 (1691)
   \`\`\`

=======================================================
【方案 1 (原本排法/基準) 核心簽床規則手冊】
=======================================================
1. 特種高級單人房 (192、119、129) 與「不限價位必單人」排床規則（步驟 0）：
   - 房型意願若為「不限價位必單人」（或包含「不限價位」），系統校正後意願視同 \`1>1(192)>1(119)>1(129)\`。
   - 【純他科高級單人房意願】（如 1(192)、1(119)、1(129)，未包含本院通用單人床 1 或雙人/4人床）：
     不需要排本院 113~124 病床，原則上跟其他科借床，狀態直接填寫對應房號（如 \`192\`、\`119\` 或 \`129\`），視同後續向他科手動借床，【絕對不佔用本院 113~124 可用空床，且不列入 delay，直接視為已排床】。
   - 【含本院單人床候補意願者】（如 \`1(192)>1\` 或 \`1>1(192)>1(119)>1(129)\`）：
     優先替病人搜尋本院 113~124 可用單人床（嚴格限單人床，不降轉雙人或四人床）；若本院全院皆無可用單人床，則依規則直接填入 \`192\`（或意願首選之他科房號），視同轉向他科手動借床，【標記為已排床且不列入 delay】。

2. 急診病人 (ER/EICU) 判定與排床位階體系：
   - 急診病人辨識來源：檢視病人名單之【聯絡/抗凝】、【抵達通知】、【其他備註】、【房型意願】四大欄位，若包含 EICU、ER（精確詞邊界比對，排除 ERCP、ERBD、liver 等臨床處置或名詞誤判）或「急診」字樣，即判定為急診病人。
   - 【第一位階（最優先）】：抵達通知 (arrival) 明確包含「準時」二字之病人，依校正後房型意願僅比對其主治醫師是否有對應本床（步驟 1）。（1782 若無本床可先借用 1699/1691 124空床；其餘醫師本床優先，不在此步驟借床）。
   - 【第二位階（次優先）】：經判定為急診 (ER/EICU) 且【主治醫師欄位有登錄醫師】之病人。該病人群位階比所有沒有準時的普通病人優先，但排在準時病人後面；排序方式亦先依房型意願比對主治醫師本床（步驟 1.5）。（1782 若無本床可借用 1699/1691 124空床）。
   - 【第三位階（一般待排）】：若急診病人主治醫師欄位沒有人（未指定主治醫師），位階與其他沒有準時的普通病人相同。全體剩餘待排病人依照【Delay 天數多者優先】（同 delay 天數時 1782 享 delay-1 等效優勢，短天數住院優先；同位階時依校正後房型種類最少者優先，只有1 > 只有2$ > 只有2與只有4，同條件採隨機排序），依房型意願比對主治醫師本床（步驟 2）。無主治醫師之急診病人因無專屬本床，保留至後續借床步驟。

3. 方案 1 嚴格五大階段執行順序（必須單向依序執行，不得跳步或交錯）：
   - 步驟 0：純他科高級單人房病人處理（意願為純 1(192)、1(119)、1(129) 者，直接標記該房號已排床，不佔本院空床，不計入 delay）。
   - 步驟 1（第一位階 - 最優先）：抵達通知包含「準時」病人，比對主治醫師本床。
     順序：1782 準時病人配對本床 -> 1782 若無本床先借用 1699/1691 124病房空床 -> 1699/1691 準時病人配對本床 -> 其餘醫師準時病人配對本床。（同位階依校正後意願種類最少者優先：只有1 > 只有2$ > 只有2與只有4，同條件採隨機排序；未排定者保留至步驟 3 同病房借床）。
   - 步驟 1.5（第二位階 - 次優先）：有主治醫師之急診優先病人（ER/EICU），比對主治醫師本床。
     順序：依 effective_delay（1782 享 +1 天優勢）排序，同天數依醫師位階（1782 > 1699/1691 > 其他）。1782 急診優先配本床 -> 1782 若無本床借用 1699/1691 124空床 -> 1699/1691 急診優先配本床 -> 其餘醫師急診優先配本床。（同位階依校正後意願種類最少者優先：只有1 > 只有2$ > 只有2與只有4，同條件採隨機排序；未排定者保留至步驟 3 同病房借床）。
   - 步驟 2（第三位階 - 剩餘待排）：普通病人與無主治急診病人，依照【Delay 天數多者優先】比對主治醫師本床（確保全員專屬本床在被借出前保留給自己病人）。
     排序：Delay 天數多者優先（1782 享 delay-1 等效優勢；短天數住院者優先；同天數時 1782 > 1699/1691 > 其他；次依急診優先；同位階依校正後意願種類最少者優先：只有1 > 只有2$ > 只有2與只有4，同條件採隨機排序）。1782 病人若無本床，優先借用 124 病房 1699/1691 空床。（無主治醫師急診病人無本床，保留至步驟 4 借床）。
   - 步驟 3：步驟 1（準時）與步驟 1.5（急診優先）未排定本床之病人，向【同病房其他主治醫師】借床。
     借床挑選順序（以同病房內符合性別與意願之可用空床比對）：
     1) 代理之請假醫師床位最優先（若病人主治為代理醫師且請假醫師在同病房有床，最優先讓代理醫師病人入住，Tier -1）。
     2) 同病房非優先借床之一般醫師（如 1460, 6382 等）（Tier 0 最優先）。
     3) 優先借床醫師（1699, 1691）（Tier 1 次選）。
     4) 不優先借床醫師（1772, 5383, 5380, 1403）（Tier 2 最後才借）。
     同等級床位中，雙空已用一床（one_used）優先於全新雙空（both_empty），床號小者優先。
   - 步驟 4：剩餘所有未排定病人排床（包含步驟 2 未排到的一般病人、無主治急診病人，與步驟 3 未借到床之優先病人）：
     排序：同步驟 2（Delay 天數多者優先，1782 享 +1 天優勢，短天數住院優先）。
     4.1 優先在同病房內借床（方便查房原則）：主治本床 -> 代理請假醫師床位 -> 雙空一床已用 (one_used) -> 急診優先 Young V 衝勁醫師床位 -> 124 互借群組 -> 一般醫師 -> 不優先借床醫師 (1772, 5383, 5380, 1403) -> 床號小者。
     4.2 若同病房無合適空床，才跨病房向其他病房借床：代理請假醫師床位 -> 雙空一床已用 -> 急診優先 Young V 衝勁醫師床位 -> 一般醫師 -> 不優先借床醫師 -> 床號小者。
     4.3 若為含單人床候補者（如 1>1(192)）且本院無單人床：轉為他科借床寫 192（或首選 119/129），不佔本院床，直接標記已排床，不列入 delay。
     4.4 若經上述途徑仍無可用合適空床：標記延後住院，格式化為 \`delay (原天數 + 1)\`（原本無 delay 則標記為 \`delay 1\`）。

4. 1699、1691、1782 醫師病人優先排入 124 病房：
   - 1699（吳啟榮）、1691（齊振達）、1782（黃怡翔）三位主治醫師之病人【盡量都放在 124 病房】，優先排主治醫師自己的床位，若無則優先安排 124 病房其他主治醫師的床位（1699、1691、1782 互相支援借床優先）。
   - 【除非 124 沒有床位】：若 124 病房完全沒有符合意願與性別的可用床位，才允許向其他病房借床。
   - 1782 醫師的專屬床位，原則上優先保留給 1782、1699、1691 醫師之病人，不借給其他非 124 醫師。

5. 全院同病房集中照護（方便查房原則）：
   - 全院所有病房（113, 121, 122, 123, 124）簽床時，均應【盡量把該主治醫師的病人放在其原本主治醫師所屬主要病房（Home Ward）內的其他主治醫師床位】（向同病房同仁借床）。
   - 目的是讓每位主治醫師的住院病人盡可能集中在同一個病房內，極大化方便主治醫師查房照護，避免醫師跨病房、跨樓層奔波。
   - 只有在該主治醫師所屬病房確實無任何符合意願與條件的床位時，才可跨病房借床。

6. Young V 醫師燈號名單與急診收治：
   - 目前登錄之 Young V（年輕主治醫師）名單：${youngVDisplay}。
   - Young V 代表體力、衝勁較佳且年輕的主治醫師，【適合收治急診（ER）簽床病人】；跨病房借床時，急診病人優先分配 Young V 醫師所屬之床位。

7. 1782 醫師病人優先於 1699 與 1691 醫師病人：
   - 第一輪準時情況：若 1782 醫師無本床但仍有準時病人，先搜尋並借用 1699 與 1691 之 124 空床，接續才考慮 1699 與 1691 的準時病人。
   - 非準時情況：亦由 1782 病人優先於 1699/1691 病人住院（1782 無本床時優先借用 124 病房 1699/1691 之空床）。
   - Delay 天數比對：1782 病人與 1699 或 1691 相比視同 delay - 1 天（1782 享有 +1 天 delay 等效優勢且優先）。

8. 方案 1 房型意願判定、健保房型與 4 人床限制規範（嚴格維持原始意願）：
   - 房型意願包含「單」、「單人」、「1」等字樣者，視同可接受 \`$2\`（自費差額雙人床）或自費單人床。
   - 房型意願包含「榮」字樣者（榮民享有雙人差額補助），意願統一設定為 \`2$>2\`（優先安排差額雙人床 2$，次選健保雙人床 2）。
   - 【健保床、健保、或 健保2、2人優先 都應該視為 2>4】：健保雙人床優先，若無合適雙人床則可安排入住 4 人健保床。
   - 【2>2$ 與 2人床 (NHI > $)】：方案 1 嚴格維持 2>2$（健保雙人床優先，差額雙人床次之），【嚴禁擅自更動為 2$>2】！
   - 【只有 2，絕對不可排 4 人床之限制】：
     1) 明確標註「必健保2」這類字樣（如必健保2、健保2 only、只要健保2、必2、不排4等）；
     2) 意願中未包含 4 之自費高階房型（如單人、差額雙人、榮民）。
     以上情況絕對不能使用 4 人床，無符合之單人或雙人床時應列入 delay 延後住院。
   - 只有意願中明確包含「必健保」、「only健保」、「健保only」等字樣者，才絕對只能住健保床，不可排差額床。

9. 借床禁令與不優先借床名單：
   - 1782（黃怡翔）與 1772（朱啟仁）不能互借床位。
   - 1772 不能借 124 病房的任何床位。
   - 1782 不能借 121 病房的任何床位。
   - 1782 的專屬床位不借給非 124 醫師。
   - 【雙空床位借床規則】：
     1) 兩床皆空時原則上不借床，若所屬主治醫師沒有剛好適合該床位的病人則保留供後續使用。
     2) 當雙空的其中一床已被使用，同房另一床亦可被使用！但必須安排同性別病人。優先安排該床位主治醫師本人的同性別病人；若該主治醫師無符合病人，後續步驟亦允許其他醫師借床（限同性別）。
   - 1772（朱啟仁）、5383（陳宥任）、5380（于洪元）、1403（許劭榮）之床位列為【不優先借床】，僅在其他醫師床位皆無法滿足時才考慮向其借床。

10. 雙空房成組規則、不移格與智慧背景變色：
   - 【兩床為一組】：雙空床位輸入時以「每兩個數字為一組」代表同一間雙人空房（例如「14 15 16 17」代表 14、15 一間，16、17 另一間；「3 5 18 19」代表 3、5 一間，18、19 另一間）。簽床時同房兩床必須為同性別，一旦第一位病人入住，同房另一空床自動鎖定為相同性別。
   - 【同房夥伴床位使用規範】：其中一床入住後，同房夥伴床位優先提供給該主治醫師其他同性別病人入住；若無，亦可在借床階段借給其他醫師之同性別病人。
   - 【不移格規範】：雙空被排定後，數字維持在原本「雙空」格內，不可移動到男2或女2的格子。
   - 【智慧背景變色】：有簽床的床位數字以該數字的一小塊背景變色呈現（男生背景為藍色白字、女生背景為紅色白字），未排定的數字與標點維持純白背景黑字，儲存格本身維持白色。其他所有床位（男2、女2、男4、女4、隔離、單人）排定時亦全面比照此背景變色規則。

11. 隔離病床與性別限制：
   - 單人房不限性別。
   - 【隔離床規範】：隔離床可以是男生也可以是女生住，視同「健保雙人床（可為男或女）」，可安排男性或女性病人入住。
   - 男2、男4 床位僅能安排男性（M）；女2、女4 床位僅能安排女性（F）。

12. 主治醫師請假之床位初期保留與代理醫師後續使用規範：
${leavesDisplay}
   - 主治醫師請假時，該醫師之床位初期不更換為其他人，維持原所屬醫師（請假醫師自己的病人仍可排入其本床）。
   - 但若後續代理的主治醫師有病人要住院且代理醫師自身沒有本床時，請假主治醫師的空床優先提供給該代理醫師使用（標註代理借床）。

13. 短天數住院（一日、兩天一夜、三天兩夜、3天2夜等）借床優先規則：
   - 病人備註中若包含「一日」、「兩天一夜」、「三天兩夜」、「3天2夜」等特徵，表示住院天數少（1~3天即出院），對出借醫師影響最小，為最適合向其他醫師借床之人選，在借床排位時優先安排借床。

14. 輸入時已指定床位之病人與床位佔用排除規範：
   - 若病人於輸入時「狀態/床位」欄位即已指定床位（例如已正規化之 113-5、124-35 等），該病人視為已排定床位，不參與本次簽床運算。
   - 該指定床位已被佔用，絕對不可再分配給其他待排病人，已自可用空床清單中排除。

15. 排不出床之 Delay 標記規則：
   - 若當日全院無合適空床而排不出床，請嚴格格式化為 \`delay + 空格 + 數字\` 代表累計延後天數（原本沒有 delay 的病人當天排不出改成 \`delay 1\`；原本為 \`delay 1\` 當天排不出改成 \`delay 2\`；原本為 \`delay 2\` 則改成 \`delay 3\`，依此類推）。

16. 重複排床與名單重置規範：
   - 若使用者重新排床，必須以導入時之原始名單與初始可用空床為基準重新計算，已連鎖轉性別之雙空房應還原為雙空重新進行最佳化分配。

17. 狀態/床位借床註記規範（填寫數字燈號而非名字，嚴禁「借床-」字眼）：
   - 若向其他醫師借床（包含同病房借床、跨病房借床或代理借床），在「狀態/床位」欄位請一律直接標記該床位醫師之【數字燈號而非名字】，格式例如 \`121-25 (5383)\` 或 \`124-2 (1691)\`。
   - 【代班情況規範】：若遇主治醫師請假有代班醫師代理、或向代理醫師借床，請直接填入【代班的主治醫師燈號】（例如代班醫師燈號為 6410，則填寫 \`121-25 (6410)\`）。
   - 【刪除借床字眼】：絕對不要出現「借床-」或「代理借床-」等前綴文字，直接保留 \`(燈號)\` 即可，切勿填寫醫師中文姓名，以利一鍵複製整欄貼上至 Excel / Google Sheet。

18. 方案 1 雙策略模擬比對與本床最高佔比自動擇優輸出：
   - 方案 1 簽床演算法精確模擬比對兩次運算：
     1) 策略 A（保留雙空）：配對本床時以常規床位優先（男2/女2/男4/女4/單人/隔離），雙空全空床盡量保留（除非雙空已用一床 one_used 才優先補滿同房）。
     2) 策略 B（先分配雙空）：配對本床時優先使用雙空全空床開房湊房。
   - 方案 1 系統精確統計兩種策略之「原本主治醫師床位放該主治醫師病人的比例（本床率 = own_doc_count / assigned_count）」，自動挑選本床比例最高之策略作為最終輸出呈現！（本床率相同時依本床數多者、總排定數多者擇優）。

=======================================================
【當前輸入資料 (Input JSON)】
=======================================================

### 1. 目前各病房可用空床清單 (Available Beds)
\`\`\`json
${bedsJsonStr}
\`\`\`

### 2. 待簽病人需求清單 (Patients - 去除姓名，嚴格保持原始順序)
\`\`\`json
${patientsJsonStr}
\`\`\`

### 3. 各病房主要主治醫師歸屬表 (Wards & Doctors)
\`\`\`json
${wardDocJsonStr}
\`\`\`

請立即開始運算，並完全按照【方案 1 (原本排法/基準)】所有規則，依【原始病人排列順序】(Patient order 1 至 ${patientsJsonData.length}) 依序輸出簽床建議結果！
`;
        return prompt.trim();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BedConfigManager, BedAssignmentEngine, AIPromptGenerator };
}
