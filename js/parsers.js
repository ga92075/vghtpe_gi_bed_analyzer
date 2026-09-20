/**
 * 病房簽床床位管理系統 - 檔案與剪貼簿解析模組 (Parsers)
 * 包含：
 * 1. parseBedString: 床位字串與範圍解析
 * 2. DocxParser: 利用 JSZip + DOMParser 解析病房分配表 Word 檔 (.docx)
 * 3. ExcelPatientParser: 利用 SheetJS (XLSX) 解析本日入院病人名單 Excel 檔 (.xlsx) 與剪貼簿 TSV
 */

/**
 * 將逗點、空白或頓號隔開的床號字串轉為整數清單，支援範圍（例如 '1, 2, 3' 或 '10-15, 24' 或 '1~12'）。
 * 若包含跨病房註記格式（如 123-38 或 124-1~12），自動辨識實際床號並防呆排除病房號碼。
 */
function parseBedString(bedStr) {
    if (!bedStr) return [];
    let s = String(bedStr).replace(/，/g, ',').replace(/、/g, ',').replace(/～/g, '~');
    const parts = s.trim().split(/[,;\s]+/);
    const beds = [];
    const knownWards = new Set(['113', '121', '122', '123', '124']);

    for (let part of parts) {
        part = part.trim();
        if (!part) continue;

        // 1. 檢查病房前綴帶範圍格式，如 124-1~12 或 124-1-12
        const mWardRange = part.match(/^(?:A?(\d{3}))[-_](\d+)\s*[-~]\s*(\d+)$/);
        if (mWardRange && knownWards.has(mWardRange[1])) {
            const start = parseInt(mWardRange[2], 10);
            const end = parseInt(mWardRange[3], 10);
            const minV = Math.min(start, end);
            const maxV = Math.max(start, end);
            for (let b = minV; b <= maxV; b++) beds.push(b);
            continue;
        }

        // 2. 檢查是否為跨病房單床格式，如 123-38 或 A123-38
        const mCross = part.match(/^(?:A?(\d{3}))[-_](\d+)$/);
        if (mCross && knownWards.has(mCross[1])) {
            beds.push(parseInt(mCross[2], 10));
            continue;
        }

        // 3. 檢查一般範圍格式，如 1-10 或 1~10
        if (part.includes('-') || part.includes('~')) {
            const m = part.match(/^(\d+)\s*[-~]\s*(\d+)$/);
            if (m) {
                const start = parseInt(m[1], 10);
                const end = parseInt(m[2], 10);
                if (knownWards.has(String(start)) && end < 100) {
                    beds.push(end);
                } else if (start <= end && (end - start) < 300) {
                    for (let b = start; b <= end; b++) beds.push(b);
                } else {
                    beds.push(start);
                    beds.push(end);
                }
            } else {
                const n = parseInt(part, 10);
                if (!isNaN(n)) beds.push(n);
            }
        } else {
            const n = parseInt(part, 10);
            if (!isNaN(n)) beds.push(n);
        }
    }

    const uniqueBeds = Array.from(new Set(beds)).sort((a, b) => a - b);
    return uniqueBeds;
}

const DocxParser = {
    /**
     * 將床位字串解析，若發現如 123-38 這種跨病房床位標記，
     * 將其與當前病房床位分開，回傳 { currTokens, crossWardBeds: [{ targetWard, bedNum }] }
     */
    splitBedTokensAndCross(bedStr, currentWardClean) {
        if (!bedStr) return { bedStr: "", crossBeds: [] };
        let s = String(bedStr).replace(/，/g, ',').replace(/、/g, ',');
        const parts = s.split(/[,;\s]+/).map(p => p.trim()).filter(Boolean);
        const currTokens = [];
        const crossBeds = [];
        const knownWards = new Set(['113', '121', '122', '123', '124']);

        for (const part of parts) {
            const m = part.match(/^(?:A?(\d{3}))[-_](\d+)$/);
            if (m && knownWards.has(m[1])) {
                const targetW = m[1];
                const targetB = parseInt(m[2], 10);
                if (targetW !== currentWardClean) {
                    crossBeds.push({ targetWard: targetW, bedNum: targetB });
                } else {
                    currTokens.push(String(targetB));
                }
            } else {
                currTokens.push(part);
            }
        }
        return { bedStr: currTokens.join(', '), crossBeds };
    },

    /**
     * 從 docx ArrayBuffer 解析出 XML 資料並結構化
     */
    async parseDocx(arrayBuffer, fileName = "病房簽床床位分配表.docx") {
        if (typeof JSZip === 'undefined') {
            throw new Error("找不到 JSZip 庫，請確認網路連線或載入 jszip.min.js");
        }

        const zip = await JSZip.loadAsync(arrayBuffer);
        const xmlFile = zip.file("word/document.xml");
        if (!xmlFile) {
            throw new Error("無效的 Word 檔：找不到 word/document.xml");
        }
        const xmlText = await xmlFile.async("text");
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "application/xml");

        // 提取所有段落文字
        const pNodes = xmlDoc.getElementsByTagName("w:p");
        const allParagraphs = [];
        for (let i = 0; i < pNodes.length; i++) {
            const t = pNodes[i].textContent ? pNodes[i].textContent.trim() : "";
            if (t) allParagraphs.push(t);
        }

        let version = "未知版本";
        const extensions = [];
        const pricing = [];
        const rules = [];

        for (const pTxt of allParagraphs) {
            if (pTxt.includes('版') && (pTxt.includes('202') || pTxt.includes('203') || pTxt.includes('年'))) {
                version = pTxt;
            } else if (pTxt.includes('EICU:') || pTxt.includes('RAD') || pTxt.includes('OPD')) {
                extensions.push(pTxt);
            } else if (pTxt.includes('房價')) {
                pricing.push(pTxt);
            } else if (pTxt.includes('健保') || pTxt.includes('隔離床')) {
                rules.push(pTxt);
            }
        }

        // 解析請假
        const leaves = [];
        for (const pTxt of allParagraphs) {
            const m = pTxt.match(/([^\s]+?)醫師\s*([0-9/]+-[0-9/]+)\s*請假[，,]\s*由\s*([^\s]+?)醫師代理/);
            if (m) {
                leaves.push({
                    doctor: m[1].trim(),
                    period: m[2].trim(),
                    proxy: m[3].trim(),
                    raw: pTxt
                });
            }
        }

        // 解析表格
        const tblNodes = xmlDoc.getElementsByTagName("w:tbl");
        if (tblNodes.length === 0) {
            throw new Error("文件中未找到表格元素");
        }
        const tbl = tblNodes[0];
        // 取得直接子代的 w:tr
        const trNodes = [];
        for (let i = 0; i < tbl.childNodes.length; i++) {
            const node = tbl.childNodes[i];
            if (node.nodeName === "w:tr" || node.localName === "tr") {
                trNodes.push(node);
            }
        }

        function extractCellParagraphs(tc) {
            const paras = [];
            const pList = tc.getElementsByTagName("w:p");
            for (let i = 0; i < pList.length; i++) {
                const t = pList[i].textContent ? pList[i].textContent.trim() : "";
                if (t) paras.push(t);
            }
            return paras;
        }

        function getCellNodes(tr) {
            const cells = [];
            for (let i = 0; i < tr.childNodes.length; i++) {
                const node = tr.childNodes[i];
                if (node.nodeName === "w:tc" || node.localName === "tc") {
                    cells.push(node);
                }
            }
            return cells;
        }

        const wardMap = [];
        let currentWard = null;
        let currentRows = [];

        for (let rIdx = 0; rIdx < trNodes.length; rIdx++) {
            const tcs = getCellNodes(trNodes[rIdx]);
            if (tcs.length === 0) continue;
            const wText = tcs[0].textContent ? tcs[0].textContent.trim() : "";
            if (/^(?:A?\d{3})$/.test(wText)) {
                if (currentWard) {
                    wardMap.push({ wardName: currentWard, rIndices: currentRows });
                }
                currentWard = wText;
                currentRows = [rIdx];
            } else if (currentWard) {
                currentRows.push(rIdx);
            }
        }
        if (currentWard) {
            wardMap.push({ wardName: currentWard, rIndices: currentRows });
        }

        const wardsData = {};
        const crossWardAssignments = [];

        for (const item of wardMap) {
            const wardName = item.wardName;
            const rIndices = item.rIndices;
            const firstTr = trNodes[rIndices[0]];
            const tcs = getCellNodes(firstTr);
            if (tcs.length < 3) continue;

            const docParas = extractCellParagraphs(tcs[1]);
            const bedParas = extractCellParagraphs(tcs[2]);

            const normalizedBedParas = [];
            for (const bp of bedParas) {
                if (bp.includes(' ') && docParas.length > bedParas.length) {
                    const splitBp = bp.split(' ').map(x => x.trim()).filter(Boolean);
                    normalizedBedParas.push(...splitBp);
                } else {
                    normalizedBedParas.push(bp);
                }
            }

            const currentCleanWard = wardName.replace('A', '');
            const doctors = [];

            for (let i = 0; i < docParas.length; i++) {
                const dp = docParas[i];
                const docM = dp.match(/([^\d\s]+)\s*([0-9A-Z]+)/);
                const name = docM ? docM[1].trim() : dp.trim();
                const code = docM ? docM[2].trim() : "";
                const rawBedStr = i < normalizedBedParas.length ? normalizedBedParas[i] : "";

                const { bedStr: currBedStr, crossBeds } = this.splitBedTokensAndCross(rawBedStr, currentCleanWard);
                const expandedBeds = parseBedString(currBedStr);

                let leaveInfo = null;
                for (const l of leaves) {
                    if (l.doctor === name || name.includes(l.doctor) || l.doctor.includes(name)) {
                        leaveInfo = l;
                        break;
                    }
                }

                doctors.push({
                    name,
                    code,
                    bed_str: currBedStr,
                    beds: expandedBeds,
                    leave_info: leaveInfo
                });

                for (const cb of crossBeds) {
                    crossWardAssignments.push({
                        targetWard: cb.targetWard,
                        name,
                        code,
                        bedNum: cb.bedNum,
                        leaveInfo
                    });
                }
            }

            // 檢查是否為單人病房
            let isSingle = false;
            for (const r of rIndices) {
                if (trNodes[r].textContent && trNodes[r].textContent.includes('單')) {
                    isSingle = true;
                    break;
                }
            }

            wardsData[wardName] = {
                doctors,
                is_single: isSingle
            };
        }

        // 處理跨病房床位指派 (例如 124 病房中的 123-38 指派給 123 李癸汌醫師)
        for (const cwa of crossWardAssignments) {
            const tw = cwa.targetWard;
            let targetWardKey = Object.keys(wardsData).find(k => k.replace('A', '') === tw) || tw;
            if (!wardsData[targetWardKey]) {
                wardsData[targetWardKey] = { doctors: [], is_single: false };
            }

            const cleanCode = cwa.code.replace(/\D/g, '');
            let docMatch = wardsData[targetWardKey].doctors.find(d => {
                const dClean = (d.code || '').replace(/\D/g, '');
                return d.name === cwa.name || (cleanCode && dClean === cleanCode);
            });

            if (docMatch) {
                if (!docMatch.beds.includes(cwa.bedNum)) {
                    docMatch.beds.push(cwa.bedNum);
                    docMatch.beds.sort((a, b) => a - b);
                    docMatch.bed_str = docMatch.beds.join(', ');
                }
            } else {
                wardsData[targetWardKey].doctors.push({
                    name: cwa.name,
                    code: cwa.code,
                    bed_str: String(cwa.bedNum),
                    beds: [cwa.bedNum],
                    leave_info: cwa.leaveInfo
                });
            }
        }

        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        return {
            file_path: fileName,
            file_name: fileName,
            version,
            extensions,
            pricing,
            rules,
            leaves,
            wards: wardsData,
            updated_at: dateStr
        };
    }
};

const ExcelPatientParser = {
    /**
     * 從床位/狀態字串中解析已延後天數。
     * 例如 'delay 1' -> 1, 'delay1' -> 1, 'delay 2' -> 2, 'delay' -> 1, 空白/其它 -> 0
     */
    extractDelayDays(statusBed) {
        if (!statusBed) return 0;
        const s = String(statusBed).trim();
        const m = s.match(/\bdelay\s*(\d+)/i);
        if (m) return parseInt(m[1], 10);
        if (/\bdelay\b/i.test(s)) return 1;
        return 0;
    },

    /**
     * 從輸入的狀態/床位字串中擷取預先指定的床位號（擷取 '-' 前後的數字代表病房與床號）。
     * 回傳 { ward, bedNum, normStatus } 或 null
     */
    parsePreassignedBed(statusBed) {
        if (!statusBed) return null;
        const s = String(statusBed).trim();
        if (!s) return null;

        if (s.toLowerCase().includes('delay') || s.includes('延後')) {
            return null;
        }

        const sNorm = s.replace(/－/g, '-').replace(/─/g, '-').replace(/—/g, '-').replace(/–/g, '-');
        if (!sNorm.includes('-')) return null;

        const m = sNorm.match(/([A-Za-z\u4e00-\u9fa5]*\d+)\s*-\s*(\d+)(\s*\(.*?\))?/);
        if (!m) return null;

        const leftStr = m[1];
        const bedDigits = m[2];
        const suffix = m[3] ? m[3].trim() : '';

        const wardDigits = leftStr.match(/\d+/g);
        if (!wardDigits) return null;
        const ward = wardDigits[wardDigits.length - 1];

        const bedNum = parseInt(bedDigits, 10);
        const bedNumStr = isNaN(bedNum) ? bedDigits.trim() : String(bedNum);

        const normStatus = suffix ? `${ward}-${bedNumStr} ${suffix}` : `${ward}-${bedNumStr}`;
        return {
            ward,
            bedNum: bedNumStr,
            normStatus,
            0: ward,
            1: bedNumStr,
            2: normStatus,
            [Symbol.iterator]: function* () {
                yield ward;
                yield bedNumStr;
                yield normStatus;
            }
        };
    },

    /**
     * 解析從 Google Sheet 或 Excel 複製至剪貼簿的 TSV 表格文字
     */
    parseClipboardTSV(clipboardText) {
        if (!clipboardText || !String(clipboardText).trim()) {
            throw new Error("剪貼簿內容為空，請先在 Google Sheet 或 Excel 框選表格並按 Ctrl+C 複製！");
        }

        const rawLines = String(clipboardText).split(/\r?\n/).filter(ln => ln.trim());
        if (rawLines.length === 0) {
            throw new Error("剪貼簿中未偵測到任何文字資料！");
        }

        const rows = rawLines.map(line => line.split('\t').map(c => c.trim()));
        return this._parseRows(rows, "剪貼簿貼上表格");
    },

    /**
     * 利用 SheetJS 解析 Excel ArrayBuffer
     */
    parseExcel(arrayBuffer, fileName = "本日入院病人.xlsx") {
        if (typeof XLSX === 'undefined') {
            throw new Error("找不到 SheetJS (XLSX) 庫，請確認網路連線或載入 xlsx.full.min.js");
        }

        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const headerKeywords = ['狀態', '床位', '病歷', '姓名', '性別', '醫師', '診斷', '房型', '抵達', '聯絡', '情況', '處置', '備註'];

        let targetSheetName = wb.SheetNames[0];
        for (const sname of wb.SheetNames) {
            const ws = wb.Sheets[sname];
            const sampleRows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" }).slice(0, 15);
            let foundKw = false;
            for (const r of sampleRows) {
                const rText = r.join(' ');
                const matchCount = ['姓名', '病歷', '床位', '醫師', '房型'].filter(kw => rText.includes(kw)).length;
                if (matchCount >= 2) {
                    foundKw = true;
                    break;
                }
            }
            if (foundKw) {
                targetSheetName = sname;
                break;
            }
        }

        const ws = wb.Sheets[targetSheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        return this._parseRows(rows, fileName);
    },

    _parseRows(rows, fileName) {
        const headerKeywords = ['狀態', '床位', '病歷', '姓名', '性別', '醫師', '診斷', '房型', '抵達', '聯絡', '情況', '處置', '備註'];
        const colMap = {
            status: 0, contact: 1, arrival: 2, cond: 3, protocol: 4,
            chart_no: 5, name: 6, gender: 7, doc_code: 8, diagnosis: 9, bed_pref: 10
        };

        const patients = [];
        let consecutiveEmpty = 0;
        let headerFound = false;

        for (let rIdx = 0; rIdx < rows.length; rIdx++) {
            const row = rows[rIdx];
            const hasData = row.some(v => v !== null && v !== undefined && String(v).trim() !== '');
            if (!hasData) {
                if (headerFound || patients.length > 0) {
                    consecutiveEmpty++;
                    if (consecutiveEmpty >= 25) break;
                }
                continue;
            }
            consecutiveEmpty = 0;

            const nonEmpties = row.map(v => String(v || '').trim()).filter(Boolean);
            const matches = headerKeywords.filter(kw => nonEmpties.some(c => c.includes(kw))).length;
            const isHeader = (matches >= 2) || nonEmpties.some(c => ['狀態/床位', '病歷號', '醫師代碼', '醫師燈號', '燈號', '房型意願', '姓名', '主治醫師'].includes(c));

            if (isHeader) {
                headerFound = true;
                for (let cIdx = 0; cIdx < row.length; cIdx++) {
                    const cText = String(row[cIdx] || '').trim();
                    if (cText.includes('狀態') || cText.includes('床位')) colMap.status = cIdx;
                    else if (cText.includes('聯絡')) colMap.contact = cIdx;
                    else if (cText.includes('抵達')) colMap.arrival = cIdx;
                    else if (cText.includes('情況')) colMap.cond = cIdx;
                    else if (cText.includes('專案') || cText.includes('處置') || cText.includes('備註')) colMap.protocol = cIdx;
                    else if (cText.includes('病歷')) colMap.chart_no = cIdx;
                    else if (cText.includes('姓名')) colMap.name = cIdx;
                    else if (cText.includes('性別')) colMap.gender = cIdx;
                    else if (cText.includes('代碼') || cText.includes('燈號')) colMap.doc_code = cIdx;
                    else if (cText.includes('主治') || cText.includes('醫師')) colMap.doctor = cIdx;
                    else if (cText.includes('診斷')) colMap.diagnosis = cIdx;
                    else if (cText.includes('房型') || cText.includes('意願')) colMap.bed_pref = cIdx;
                }
                continue;
            }

            const getVal = (key, defaultIdx) => {
                const idx = colMap[key] !== undefined ? colMap[key] : defaultIdx;
                return (idx >= 0 && idx < row.length && row[idx] !== null && row[idx] !== undefined) ? String(row[idx]).trim() : '';
            };

            const rawStatus = getVal('status', 0);
            const contact = getVal('contact', 1);
            const arrival = getVal('arrival', 2);
            const cond = getVal('cond', 3);
            const protocol = getVal('protocol', 4);
            const chartNo = getVal('chart_no', 5);
            const name = getVal('name', 6);
            let gender = getVal('gender', 7).toUpperCase();
            if (gender === '男' || gender === '1') gender = 'M';
            else if (gender === '女' || gender === '2') gender = 'F';
            else if (gender !== 'M' && gender !== 'F') gender = gender.startsWith('M') ? 'M' : (gender.startsWith('F') ? 'F' : 'M');

            let doctor = getVal('doctor', -1);
            let docCode = getVal('doc_code', 8);

            // 若只有單一欄位記錄醫師/燈號 (例如 1782 或 黃怡翔 或 1782黃怡翔)
            if (!doctor && docCode && !/^\d+$/.test(docCode)) {
                doctor = docCode.replace(/\d+/g, '').replace(/[\s\-_()]/g, '');
            }
            if (doctor && !docCode && /\d+/.test(doctor)) {
                const mCode = doctor.match(/\d+/);
                if (mCode) docCode = mCode[0];
            }

            if (!name && !chartNo && !docCode && !doctor) continue;

            const preassigned = this.parsePreassignedBed(rawStatus);
            let assignedWard = "";
            let assignedBed = "";
            let isAssigned = false;
            let statusBed = rawStatus;

            if (preassigned) {
                assignedWard = preassigned.ward;
                assignedBed = preassigned.bedNum;
                statusBed = preassigned.normStatus;
                isAssigned = true;
            } else if (rawStatus && !(rawStatus.toLowerCase().includes('delay') || rawStatus.includes('延後') || rawStatus.includes('待') || ['-', '無'].includes(rawStatus))) {
                const mVip = rawStatus.match(/\b(192|119|129)\b/);
                if (mVip) {
                    assignedWard = mVip[1];
                    assignedBed = mVip[1];
                    statusBed = rawStatus;
                    isAssigned = true;
                }
            }

            const initDelay = this.extractDelayDays(statusBed);
            const normalizedPref = typeof BedAssignmentEngine !== 'undefined' ? BedAssignmentEngine.getNormalizedPreference(bedPref) : bedPref;

            patients.push({
                row_idx: rIdx + 1,
                status_bed: statusBed,
                status_bed_1: statusBed,
                status_bed_2: statusBed,
                status_bed_3: statusBed,
                status_bed_4: statusBed,
                assigned_ward_1: assignedWard,
                assigned_bed_1: assignedBed,
                is_assigned_1: isAssigned,
                assigned_ward_2: assignedWard,
                assigned_bed_2: assignedBed,
                is_assigned_2: isAssigned,
                assigned_ward_3: assignedWard,
                assigned_bed_3: assignedBed,
                is_assigned_3: isAssigned,
                assigned_ward_4: assignedWard,
                assigned_bed_4: assignedBed,
                is_assigned_4: isAssigned,
                raw_status_bed: rawStatus,
                initial_delay_days: initDelay,
                is_assigned: isAssigned,
                assigned_ward: assignedWard,
                assigned_bed: assignedBed,
                contact,
                arrival,
                cond,
                protocol,
                chart_no: chartNo,
                name,
                gender,
                doctor: doctor || '',
                doctor_name: doctor || '',
                doc_code: docCode || '',
                diagnosis,
                bed_pref: bedPref,
                normalized_pref: normalizedPref
            });
        }

        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        return {
            file_path: fileName,
            file_name: fileName,
            patients,
            total_count: patients.length,
            assigned_count: patients.filter(p => p.is_assigned).length,
            pending_count: patients.filter(p => !p.is_assigned).length,
            male_count: patients.filter(p => p.gender === 'M').length,
            female_count: patients.filter(p => p.gender === 'F').length,
            updated_at: dateStr
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseBedString, DocxParser, ExcelPatientParser };
}
