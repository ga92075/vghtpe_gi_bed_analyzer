/**
 * 病房簽床床位管理系統 - 主應用程式控制器 (App Controller)
 * 負責 DOM 綁定、狀態維持、檔案上傳、自動排床流程、表格渲染、彈窗與本機存取
 */

class BedAnalyzerApp {
    constructor() {
        this.manager = new BedConfigManager();
        this.originalPatientData = null;
        this.hasAutoAssigned = false;
        this.currentStrategies = null;
        this.activeStrategyKey = 'original';
        this.selectedSchemeKey = 'original';
        this.selectedSchemeCol = 1; // 1, 2, 3, or 4 (對應排床1~排床4)
        this.rtBedSortActive = false; // 是否依床位順序 (113➔124) 排序
        this.docWardFilter = 'all'; // 醫師病房篩選
        this.docFilterSearch = ''; // 醫師關鍵字搜尋

        // 篩選狀態
        this.filterStatus = 'all';
        this.filterGender = 'all';
        this.filterWard = 'all';
        this.filterSearch = '';
        this.undoStack = [];

        this.initDOMReferences();
        this.initBedInputWrappers();
        this.initEventListeners();
        this.initKeyboardNavigation();
        this.initSchemeTooltips();
        this.loadInitialData();
    }

    initDOMReferences() {
        // 分頁與主題
        this.tabBtns = document.querySelectorAll('.tab-btn');
        this.tabPanes = document.querySelectorAll('.tab-pane');
        this.themeToggleBtn = document.getElementById('btn-theme-toggle');

        // 頂部與全域操作
        this.docStatusLbl = document.getElementById('doc-status-lbl');
        this.fileDocxInput = document.getElementById('file-docx');
        this.fileExcelInput = document.getElementById('file-excel');
        this.fileConfigInput = document.getElementById('file-config');
        this.btnImportDocx = document.getElementById('btn-import-docx');
        this.btnExportConfig = document.getElementById('btn-export-config');
        this.btnImportConfig = document.getElementById('btn-import-config');
        this.btnImportExcel = document.getElementById('btn-import-excel');
        this.btnImportClipboard = document.getElementById('btn-import-clipboard');
        this.youngVInput = document.getElementById('young-v-input');

        // 主畫面操作按鈕
        this.btnAutoAssign = document.getElementById('btn-auto-assign');
        this.btnRtReset = document.getElementById('btn-rt-reset');
        this.btnRtRedo = document.getElementById('btn-rt-redo');
        this.btnResetConfig = document.getElementById('btn-reset-config');
        this.btnClearAllBeds = document.getElementById('btn-clear-all-beds');
        this.btnFillTestBeds = document.getElementById('btn-fill-test-beds');
        this.btnExportPrompt = document.getElementById('btn-export-prompt');
        this.btnExportExcel = document.getElementById('btn-export-excel');
        this.btnCopySummary = document.getElementById('btn-copy-summary');
        this.btnRtSortBed = document.getElementById('btn-rt-sort-bed');

        // 病人分頁操作按鈕
        this.btnPatientsAutoAssign = document.getElementById('btn-patients-auto-assign');
        this.btnPatientsReset = document.getElementById('btn-patients-reset');
        this.btnPatientsRedo = document.getElementById('btn-patients-redo');
        this.btnPatientsCopySummary = document.getElementById('btn-patients-copy-summary');
        this.btnPatientsExportPrompt = document.getElementById('btn-patients-export-prompt');
        this.btnPatientsExportExcel = document.getElementById('btn-patients-export-excel');
        this.btnPatientsSortBed = document.getElementById('btn-patients-sort-bed');

        // 表格容器
        this.livePatientsTbody = document.getElementById('live-patients-tbody');
        this.fullPatientsTbody = document.getElementById('full-patients-tbody');
        this.overviewBedsContainer = document.getElementById('overview-beds-container');
        this.unifiedDoctorsTbody = document.getElementById('unified-doctors-tbody');
        this.leavesListContainer = document.getElementById('leaves-list-container');
        this.rulesContentContainer = document.getElementById('rules-content-container');

        // 狀態列統計元素
        this.statTotalBeds = document.getElementById('stat-total-beds');
        this.statOccupiedBeds = document.getElementById('stat-occupied-beds');
        this.statTotalPatients = document.getElementById('stat-total-patients');
        this.statAssignedPatients = document.getElementById('stat-assigned-patients');
        this.statPendingPatients = document.getElementById('stat-pending-patients');
        this.statGenderCount = document.getElementById('stat-gender-count');

        // 模態視窗
        this.strategyModal = document.getElementById('strategy-modal');
        this.promptModal = document.getElementById('prompt-modal');
        this.patientEditModal = document.getElementById('patient-edit-modal');
        this.doctorEditModal = document.getElementById('doctor-edit-modal');
        this.leaveEditModal = document.getElementById('leave-edit-modal');
        this.toastContainer = document.getElementById('toast-container');
    }

    initEventListeners() {
        // 分頁切換
        this.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                this.switchTab(targetTab);
            });
        });

        // 主題切換 (Dark / Light)
        if (this.themeToggleBtn) {
            this.themeToggleBtn.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme') || 'light';
                const next = current === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                this.themeToggleBtn.textContent = next === 'dark' ? '☀️' : '🌙';
                localStorage.setItem('bed_app_theme', next);
            });
        }

        // Young V 醫師燈號修改
        if (this.youngVInput) {
            this.youngVInput.addEventListener('input', (e) => {
                this.manager.setYoungVCodes(e.target.value);
                this.manager.saveSharedConfig();
            });
            this.youngVInput.addEventListener('change', () => {
                this.manager.saveSharedConfig();
            });
        }

        // 檔案上傳與設定匯入匯出按鈕關聯
        if (this.btnImportDocx) {
            this.btnImportDocx.addEventListener('click', () => this.fileDocxInput.click());
        }
        if (this.btnExportConfig) {
            this.btnExportConfig.addEventListener('click', () => this.exportSharedConfig());
        }
        if (this.btnImportConfig) {
            this.btnImportConfig.addEventListener('click', () => this.fileConfigInput.click());
        }
        if (this.fileDocxInput) {
            this.fileDocxInput.addEventListener('change', (e) => this.handleDocxUpload(e));
        }
        if (this.fileConfigInput) {
            this.fileConfigInput.addEventListener('change', (e) => this.handleConfigUpload(e));
        }

        if (this.btnImportExcel) {
            this.btnImportExcel.addEventListener('click', () => this.fileExcelInput.click());
        }
        if (this.fileExcelInput) {
            this.fileExcelInput.addEventListener('change', (e) => this.handleExcelUpload(e));
        }

        if (this.btnImportClipboard) {
            this.btnImportClipboard.addEventListener('click', () => this.handleClipboardImport());
        }

        // 全域快速貼上匯入 (Ctrl+V) — 瀏覽器原生規範免授權、完全不跳出詢問視窗
        window.addEventListener('paste', (e) => {
            const text = (e.clipboardData || window.clipboardData)?.getData('text');
            if (!text || !text.trim()) return;

            const activeEl = document.activeElement;
            if (activeEl && activeEl.id === 'quick-paste-input') {
                return;
            }

            // 判斷是否為病人表格格式 (包含 Tab 分隔、多行、或具有常見欄位關鍵字)
            const hasTsvOrMultiLine = text.includes('\t') || text.split(/\r?\n/).filter(l => l.trim()).length >= 2;
            const hasPatientKeywords = ['姓名', '病歷', '床位', '房型', '醫師', '診斷', '急診', '序號', '性別'].some(kw => text.includes(kw));

            const isTextEditor = activeEl && (
                activeEl.id === 'young-v-input' || 
                activeEl.id === 'prompt-content' ||
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA'
            );

            // 若使用者正在編輯一般文字輸入框且貼上的不是病人表格，則維持正常輸入
            if (isTextEditor && !hasPatientKeywords && !text.includes('\t')) {
                return;
            }

            if (hasTsvOrMultiLine || hasPatientKeywords) {
                try {
                    const result = ExcelPatientParser.parseClipboardTSV(text);
                    if (result && result.patients && result.patients.length > 0) {
                        e.preventDefault();
                        this.importPatientFromText(text, "快捷鍵 Ctrl+V（免授權、不詢問）");
                        this.closeModal('quick-paste-modal');
                    }
                } catch (err) {
                    console.warn("Pasted text not patient data", err);
                }
            }
        });

        // 綁定快速貼上彈窗輸入框事件
        const quickPasteInput = document.getElementById('quick-paste-input');
        if (quickPasteInput) {
            quickPasteInput.addEventListener('paste', (e) => {
                const text = (e.clipboardData || window.clipboardData)?.getData('text');
                if (text && text.trim()) {
                    try {
                        e.preventDefault();
                        this.importPatientFromText(text, "快捷貼上（免授權）");
                        quickPasteInput.value = '';
                        this.closeModal('quick-paste-modal');
                    } catch (err) {
                        this.showToast(err.message, "error");
                    }
                }
            });
            quickPasteInput.addEventListener('input', (e) => {
                const text = e.target.value;
                if (text && text.trim() && (text.includes('\t') || text.includes('\n'))) {
                    try {
                        this.importPatientFromText(text, "快捷貼上（免授權）");
                        e.target.value = '';
                        this.closeModal('quick-paste-modal');
                    } catch (err) {
                        // 讓使用者可繼續編輯
                    }
                }
            });
        }

        // 主操作按鈕
        if (this.btnAutoAssign) {
            this.btnAutoAssign.addEventListener('click', () => this.executeAutoAssign());
        }
        if (this.btnRtReset) {
            this.btnRtReset.addEventListener('click', () => this.undoLastAction());
        }
        if (this.btnRtRedo) {
            this.btnRtRedo.addEventListener('click', () => this.redoNextAction());
        }
        if (this.btnResetConfig) {
            this.btnResetConfig.addEventListener('click', () => this.resetToOriginal());
        }
        if (this.btnClearAllBeds) {
            this.btnClearAllBeds.addEventListener('click', () => this.clearAllBeds());
        }
        if (this.btnFillTestBeds) {
            this.btnFillTestBeds.addEventListener('click', () => this.fillTestBeds());
        }
        if (this.btnExportPrompt) {
            this.btnExportPrompt.addEventListener('click', () => this.openPromptModal());
        }
        if (this.btnExportExcel) {
            this.btnExportExcel.addEventListener('click', () => this.exportToExcel());
        }
        if (this.btnCopySummary) {
            this.btnCopySummary.addEventListener('click', () => this.copyPatientSummary());
        }
        if (this.btnRtSortBed) {
            this.btnRtSortBed.addEventListener('click', () => this.toggleRtBedSort());
        }

        // 本日入院病人名單分頁按鈕
        if (this.btnPatientsAutoAssign) {
            this.btnPatientsAutoAssign.addEventListener('click', () => this.executeAutoAssign());
        }
        if (this.btnPatientsReset) {
            this.btnPatientsReset.addEventListener('click', () => this.undoLastAction());
        }
        if (this.btnPatientsRedo) {
            this.btnPatientsRedo.addEventListener('click', () => this.redoNextAction());
        }
        if (this.btnPatientsCopySummary) {
            this.btnPatientsCopySummary.addEventListener('click', () => this.copyPatientSummary());
        }
        if (this.btnPatientsExportPrompt) {
            this.btnPatientsExportPrompt.addEventListener('click', () => this.openPromptModal());
        }
        if (this.btnPatientsExportExcel) {
            this.btnPatientsExportExcel.addEventListener('click', () => this.exportToExcel());
        }
        if (this.btnPatientsSortBed) {
            this.btnPatientsSortBed.addEventListener('click', () => this.toggleRtBedSort());
        }

        // 點擊已排定床位儲存格的淺綠色邊緣即可鎖定；點擊床位橢圓本身仍保留雙擊編輯功能。
        const bindBedLockToggle = (tbody) => {
            if (!tbody) return;
            tbody.addEventListener('click', (event) => {
                const cell = event.target.closest('.scheme-cell');
                if (!cell || !tbody.contains(cell) || event.target.closest('.badge, .cell-inline-editor')) return;
                const rowIdx = Number(cell.dataset.patientRow);
                const schemeIdx = Number(cell.dataset.schemeIdx);
                if (rowIdx && schemeIdx) this.toggleBedLock(rowIdx, schemeIdx);
            });
        };
        bindBedLockToggle(this.livePatientsTbody);
        bindBedLockToggle(this.fullPatientsTbody);

        // 全域 Ctrl+Z 上一步快速鍵 與 Ctrl+Y / Ctrl+Shift+Z 下一步快速鍵
        window.addEventListener('keydown', (e) => {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            if (activeTag === 'input' || activeTag === 'textarea') return;

            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                e.preventDefault();
                this.undoLastAction();
            } else if ((e.ctrlKey || e.metaKey) && ((e.key === 'y' || e.key === 'Y') || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) {
                e.preventDefault();
                this.redoNextAction();
            }
        });

        // 醫師病房篩選膠囊按鈕
        const pillBtns = document.querySelectorAll('#doc-ward-filter-pills .pill-btn');
        pillBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                pillBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.docWardFilter = btn.dataset.ward;
                this.renderDoctorsTab();
            });
        });
        const docFilterSearch = document.getElementById('doc-filter-search');
        if (docFilterSearch) {
            docFilterSearch.addEventListener('input', (e) => {
                this.docFilterSearch = e.target.value.trim().toLowerCase();
                this.renderDoctorsTab();
            });
        }
        const btnAddDoc = document.getElementById('btn-add-doc');
        if (btnAddDoc) {
            btnAddDoc.addEventListener('click', () => this.openDoctorEditModal('113', '', ''));
        }

        // 彈窗房型意願自動連動校正後意願
        const editBedPref = document.getElementById('edit-patient-bed-pref');
        const editNormPref = document.getElementById('edit-patient-normalized-pref');
        if (editBedPref && editNormPref) {
            editBedPref.addEventListener('input', (e) => {
                editNormPref.value = BedAssignmentEngine.getNormalizedPreference(e.target.value);
            });
        }

        // 病房輸入格事件綁定
        BedConfigManager.STANDARD_WARDS.forEach(w => {
            BedConfigManager.CATEGORIES.forEach(cat => {
                const el = document.getElementById(`input-${w}-${cat}`);
                if (el) {
                    el.addEventListener('focus', () => {
                        this._lastFocusedWardInputVal = el.value;
                    });
                    el.addEventListener('input', (e) => {
                        if (this._lastFocusedWardInputVal !== undefined && this._lastFocusedWardInputVal !== e.target.value) {
                            this.pushUndoSnapshot();
                            this._lastFocusedWardInputVal = undefined;
                        }
                        this.manager.updateInput(w, cat, e.target.value);
                        this.updateWardStatsAndChips(w);
                        this.updateBedInputHighlights(w);
                        this.updateGlobalStatusBar();
                        this.manager.saveToLocalStorage();
                    });
                    el.addEventListener('blur', () => {
                        const raw = el.value;
                        if (raw.trim() !== '') {
                            const formatted = raw.trimEnd() + ' ';
                            if (el.value !== formatted) {
                                el.value = formatted;
                                this.manager.updateInput(w, cat, formatted);
                                this.updateWardStatsAndChips(w);
                                this.updateBedInputHighlights(w);
                                this.updateGlobalStatusBar();
                                this.manager.saveToLocalStorage();
                            }
                        }
                    });
                }
            });

            const clearBtn = document.getElementById(`btn-clear-${w}`);
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    this.pushUndoSnapshot();
                    this.manager.clearWardInputs(w);
                    BedConfigManager.CATEGORIES.forEach(cat => {
                        const el = document.getElementById(`input-${w}-${cat}`);
                        if (el) el.value = '';
                    });
                    this.updateWardStatsAndChips(w);
                    this.updateBedInputHighlights(w);
                    this.updateGlobalStatusBar();
                    this.manager.saveToLocalStorage();
                    this.showToast(`已清空 ${w} 病房床位輸入`, "info");
                });
            }
        });

        // 病人篩選事件
        ['filter-status', 'filter-gender', 'filter-ward'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    this.filterStatus = document.getElementById('filter-status').value;
                    this.filterGender = document.getElementById('filter-gender').value;
                    this.filterWard = document.getElementById('filter-ward').value;
                    this.renderFullPatientsTable();
                });
            }
        });
        const searchInput = document.getElementById('filter-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterSearch = e.target.value.trim().toLowerCase();
                this.renderFullPatientsTable();
            });
        }
    }

    initKeyboardNavigation() {
        // 鍵盤方向鍵在 113~124 病房輸入框之間平滑遊走
        const wards = BedConfigManager.STANDARD_WARDS;
        // 卡片視覺網格:
        // 第 0 列: 男2, 女2, 雙空
        // 第 1 列: 男4, 女4, (統計列)
        // 第 2 列: 隔離, 單人, 留床
        const grid = [
            ['男2', '女2', '雙空'],
            ['男4', '女4', ''],
            ['隔離', '單人', '留床']
        ];

        wards.forEach((w, wIdx) => {
            grid.forEach((row, rIdx) => {
                row.forEach((cat, cIdx) => {
                    if (!cat) return;
                    const el = document.getElementById(`input-${w}-${cat}`);
                    if (!el) return;

                    el.addEventListener('keydown', (e) => {
                        let targetW = w;
                        let targetCat = null;

                        if (e.key === 'ArrowRight' && el.selectionEnd === el.value.length) {
                            if (cIdx < 2 && row[cIdx + 1]) {
                                targetCat = row[cIdx + 1];
                            } else if (rIdx === 0 && cIdx === 2) {
                                // 雙空 -> 男4
                                targetCat = '男4';
                            } else if (rIdx === 1 && cIdx === 1) {
                                // 女4 -> 隔離
                                targetCat = '隔離';
                            } else if (rIdx === 2 && cIdx === 2) {
                                // 留床 -> 下一病房 男2
                                if (wIdx < wards.length - 1) {
                                    targetW = wards[wIdx + 1];
                                    targetCat = '男2';
                                }
                            }
                        } else if (e.key === 'ArrowLeft' && el.selectionStart === 0) {
                            if (cIdx > 0 && row[cIdx - 1]) {
                                targetCat = row[cIdx - 1];
                            } else if (rIdx === 1 && cIdx === 0) {
                                // 男4 -> 雙空
                                targetCat = '雙空';
                            } else if (rIdx === 2 && cIdx === 0) {
                                // 隔離 -> 女4
                                targetCat = '女4';
                            } else if (rIdx === 0 && cIdx === 0) {
                                // 男2 -> 前一病房 留床
                                if (wIdx > 0) {
                                    targetW = wards[wIdx - 1];
                                    targetCat = '留床';
                                }
                            }
                        } else if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
                            e.preventDefault();
                            if (cIdx === 0) {
                                // 第 0 行: 男2 -> 男4 -> 隔離 -> 下一病房 男2
                                if (rIdx === 0) targetCat = '男4';
                                else if (rIdx === 1) targetCat = '隔離';
                                else if (wIdx < wards.length - 1) {
                                    targetW = wards[wIdx + 1];
                                    targetCat = '男2';
                                }
                            } else if (cIdx === 1) {
                                // 第 1 行: 女2 -> 女4 -> 單人 -> 下一病房 女2
                                if (rIdx === 0) targetCat = '女4';
                                else if (rIdx === 1) targetCat = '單人';
                                else if (wIdx < wards.length - 1) {
                                    targetW = wards[wIdx + 1];
                                    targetCat = '女2';
                                }
                            } else if (cIdx === 2) {
                                // 第 2 行: 雙空 -> 留床 -> 下一病房 雙空
                                if (rIdx === 0) targetCat = '留床';
                                else if (wIdx < wards.length - 1) {
                                    targetW = wards[wIdx + 1];
                                    targetCat = '雙空';
                                }
                            }
                        } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
                            e.preventDefault();
                            if (cIdx === 0) {
                                // 第 0 行: 隔離 -> 男4 -> 男2 -> 前一病房 隔離
                                if (rIdx === 2) targetCat = '男4';
                                else if (rIdx === 1) targetCat = '男2';
                                else if (wIdx > 0) {
                                    targetW = wards[wIdx - 1];
                                    targetCat = '隔離';
                                }
                            } else if (cIdx === 1) {
                                // 第 1 行: 單人 -> 女4 -> 女2 -> 前一病房 單人
                                if (rIdx === 2) targetCat = '女4';
                                else if (rIdx === 1) targetCat = '女2';
                                else if (wIdx > 0) {
                                    targetW = wards[wIdx - 1];
                                    targetCat = '單人';
                                }
                            } else if (cIdx === 2) {
                                // 第 2 行: 留床 -> 雙空 -> 前一病房 留床
                                if (rIdx === 2) targetCat = '雙空';
                                else if (wIdx > 0) {
                                    targetW = wards[wIdx - 1];
                                    targetCat = '留床';
                                }
                            }
                        }

                        if (targetCat) {
                            e.preventDefault();
                            const targetEl = document.getElementById(`input-${targetW}-${targetCat}`);
                            if (targetEl) {
                                targetEl.focus();
                                // 依使用者需求：按上下左右移動到不同輸入窗格的時候預設移動到該窗格的最右邊 (末端)
                                const len = targetEl.value.length;
                                targetEl.setSelectionRange(len, len);
                                targetEl.scrollLeft = targetEl.scrollWidth;
                                const targetBackdrop = document.getElementById(`backdrop-${targetW}-${targetCat}`);
                                if (targetBackdrop) {
                                    targetBackdrop.scrollLeft = targetEl.scrollLeft;
                                }
                            }
                        }
                    });
                });
            });
        });
    }

    async exportSharedConfig() {
        try {
            // 產出純淨共用設定 (包含 Word 醫師配床、請假代理、規則房價、Young V，絕不含任何病人個資)
            const payload = this.manager.exportConfigObject(false);
            this.manager.saveSharedConfig();

            const jsonStr = JSON.stringify(payload, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'bed_config.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showToast("已成功匯出設定檔 bed_config.json (絕無病人資料，可分享至其他電腦匯入)", "success");
        } catch (e) {
            console.error("匯出設定失敗:", e);
            this.showToast("匯出設定失敗: " + e.message, "error");
        }
    }

    async handleConfigUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const configData = JSON.parse(text);
            // 嚴格共用模式：載入 Word 醫師配床與規則，不影響本機私有病人名單
            this.manager.importConfigObject(configData, false);
            this.manager.saveSharedConfig();
            this.applyManagerToUI();
            this.showToast("✅ 已成功匯入共用設定檔！已套用最新醫師床位與規則配置。", "success");
        } catch (err) {
            console.error("匯入設定檔失敗:", err);
            this.showToast(`匯入設定檔失敗: ${err.message}`, "error");
        } finally {
            event.target.value = '';
        }
    }

    async syncSharedConfigToServer() {
        // 單機免伺服器版：儲存至本機 localStorage
        this.manager.saveSharedConfig();
        return true;
    }

    async loadInitialData() {
        const savedTheme = localStorage.getItem('bed_app_theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        if (this.themeToggleBtn) {
            this.themeToggleBtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
        }

        // 1. 載入共用設定 (優先自 localStorage 讀取，若為空則由 engine 自動回退至預載的 DEFAULT_BED_CONFIG)
        this.manager.loadSharedConfig();

        // 2. 獨立載入本機專屬的「病人名單表格」(不與他人共用，純本機隔離保密)
        const localPatients = this.manager.loadPrivatePatients();
        if (localPatients && this.manager.patientData && this.manager.patientData.patients && this.manager.patientData.patients.length > 0) {
            this.originalPatientData = localPatients.originalPatientData || JSON.parse(JSON.stringify(this.manager.patientData));
            this.showToast("已載入本機排床配置與暫存病人名單", "info");
        } else {
            this.originalPatientData = null;
        }

        this.applyManagerToUI();
    }

    applyManagerToUI() {
        // Young V
        if (this.youngVInput) {
            this.youngVInput.value = this.manager.getYoungVCodes();
        }

        // 填入病房輸入格 (並主動更正 113 舊快取中的 45 轉為 16 17)
        const cur113M2 = String(this.manager.getInput('113', '男2') || '').trim();
        if (cur113M2.includes('45')) {
            const fixed113 = cur113M2.replace(/\b45\b/g, '17').replace(/\s+/g, ' ').trim();
            this.manager.updateInput('113', '男2', fixed113.includes('16') ? fixed113 : '16 17');
        }

        BedConfigManager.STANDARD_WARDS.forEach(w => {
            BedConfigManager.CATEGORIES.forEach(cat => {
                const el = document.getElementById(`input-${w}-${cat}`);
                if (el) {
                    el.value = this.manager.getInput(w, cat);
                }
            });
            this.updateWardStatsAndChips(w);
            this.updateBedInputHighlights(w);
        });

        // 狀態標題
        this.updateHeaderStatus();

        // 備份原始病人名單
        if (!this.originalPatientData && this.manager.patientData && this.manager.patientData.patients && this.manager.patientData.patients.length > 0) {
            this.originalPatientData = JSON.parse(JSON.stringify(this.manager.patientData));
        }

        this.updateAllWardHighlights();
        this.renderAllTables();
        this.renderRulesTab();
        this.updateGlobalStatusBar();
    }

    updateHeaderStatus() {
        if (!this.docStatusLbl) return;
        const ver = (this.manager.data && this.manager.data.version) || "尚未載入 Word";
        const pFile = (this.manager.patientData && this.manager.patientData.file_name) || "尚未載入 Excel";
        const pCount = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients.length : 0;
        const pTag = pCount > 0 ? ` (${pCount} 位病人，本機獨立)` : " (0 位病人)";
        this.docStatusLbl.textContent = `Word: ${ver} (共用) | Excel: ${pFile}${pTag}`;
    }

    switchTab(tabId) {
        this.tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        this.tabPanes.forEach(pane => {
            pane.classList.toggle('active', pane.id === `pane-${tabId}`);
        });

        if (tabId === 'overview') this.renderOverviewTab();
        else if (tabId === 'patients') this.renderFullPatientsTable();
        else if (tabId === 'doctors') this.renderDoctorsTab();
        else if (tabId === 'rules') this.renderRulesTab();
    }

    /* ==========================================================================
       床位解析與即時晶片標籤 (Bed Chips)
       ========================================================================== */
    getAvailableBeds() {
        const availableBeds = [];
        const wards = BedConfigManager.STANDARD_WARDS;

        for (const w of wards) {
            const resVal = this.manager.getInput(w, '留床');
            const reservedBeds = new Set((parseBedString(resVal) || []).map(b => String(b)));

            for (const cat of BedConfigManager.ASSIGNABLE_CATEGORIES) {
                const bedStr = this.manager.getInput(w, cat);
                if (!bedStr) continue;

                const bNums = parseBedString(bedStr);
                for (let idx = 0; idx < bNums.length; idx++) {
                    const bNum = bNums[idx];
                    // 同病房有留床之床位視同不參與排床
                    if (reservedBeds.has(String(bNum))) continue;

                    const bedInfo = this.manager.lookupBed(w, bNum, cat);
                    const docCode = bedInfo ? (bedInfo.clean_doc_code || (bedInfo.doctor_code || '').replace(/\D/g, '')) : "";
                    const docName = bedInfo ? bedInfo.doctor_name : "未知";
                    const isIso = bedInfo ? bedInfo.is_isolation : false;

                    // 113-124 單人房為「單人5000」；122 雙人房為「2人房2400」；其餘維持「健保床」
                    const wClean = String(w).replace('A', '');
                    let isCo = false;
                    let bedType = "健保床";
                    if (cat === '單人') {
                        bedType = "單人5000";
                        isCo = true;
                    } else if (wClean === '122' && ['男2', '女2', '雙空'].includes(cat)) {
                        bedType = "2人房2400";
                        isCo = true;
                    } else {
                        bedType = "健保床";
                        isCo = false;
                    }

                    let partner = null;
                    if (cat === '雙空') {
                        if (idx % 2 === 0 && idx + 1 < bNums.length) {
                            const pCand = bNums[idx + 1];
                            partner = !reservedBeds.has(String(pCand)) ? pCand : null;
                        } else if (idx % 2 === 1) {
                            const pCand = bNums[idx - 1];
                            partner = !reservedBeds.has(String(pCand)) ? pCand : null;
                        }
                    }

                    availableBeds.push({
                        ward: w,
                        bed_num: bNum,
                        category: cat,
                        is_co_pay: isCo,
                        doctor_code: bedInfo ? bedInfo.doctor_code : "",
                        clean_doc_code: docCode,
                        doctor_name: docName,
                        is_isolation: isIso,
                        bed_type: bedType,
                        is_single: (cat === '單人'),
                        twin_partner: partner,
                        is_double_empty: (cat === '雙空' && partner !== null),
                        locked_gender: null
                    });
                }
            }
        }
        return availableBeds;
    }

    // 留床不參與自動排床，但仍是空床數顯示的一部分。
    getReservedBedKeys() {
        const reservedBedKeys = new Set();
        for (const ward of BedConfigManager.STANDARD_WARDS) {
            const beds = parseBedString(this.manager.getInput(ward, '留床')) || [];
            beds.forEach(bed => {
                const bedNum = String(bed).trim();
                const normalizedBedNum = /^\d+$/.test(bedNum) ? String(parseInt(bedNum, 10)) : bedNum;
                if (normalizedBedNum) reservedBedKeys.add(`${ward}-${normalizedBedNum}`);
            });
        }
        return reservedBedKeys;
    }

    initBedInputWrappers() {
        BedConfigManager.STANDARD_WARDS.forEach(w => {
            BedConfigManager.CATEGORIES.forEach(cat => {
                const input = document.getElementById(`input-${w}-${cat}`);
                if (!input) return;

                let wrapper = input.closest('.bed-input-wrapper');
                let backdrop = document.getElementById(`backdrop-${w}-${cat}`);

                if (!wrapper) {
                    wrapper = document.createElement('div');
                    wrapper.className = 'bed-input-wrapper';
                    input.parentNode.insertBefore(wrapper, input);

                    backdrop = document.createElement('div');
                    backdrop.className = 'bed-input-backdrop';
                    backdrop.id = `backdrop-${w}-${cat}`;
                    wrapper.appendChild(backdrop);
                    wrapper.appendChild(input);
                }

                if (!wrapper._hasClickBound) {
                    wrapper._hasClickBound = true;
                    wrapper.addEventListener('click', (e) => {
                        if (e.target !== input) {
                            input.focus();
                            const len = input.value.length;
                            input.setSelectionRange(len, len);
                        }
                    });
                }

                if (input && backdrop) {
                    const syncScroll = () => {
                        backdrop.scrollLeft = input.scrollLeft;
                    };
                    input.addEventListener('scroll', syncScroll);
                    input.addEventListener('input', syncScroll);
                    input.addEventListener('keyup', syncScroll);
                    input.addEventListener('click', syncScroll);
                    input.addEventListener('select', syncScroll);
                }
            });
        });
    }

    /**
     * 建立目前已排定/有人住的床位對照表 (嚴格對齊 bed_analyzer.pyw: get_occupied_bed_map)
     * 回傳字典格式: { "113-16": patient, ... }
     */
    getOccupiedBedMap(schemeIdx = null) {
        const occupied = {};
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        const activeCol = schemeIdx !== null ? schemeIdx : (this.selectedSchemeCol || 1);
        const wardKey = `assigned_ward_${activeCol}`;
        const bedKey = `assigned_bed_${activeCol}`;
        const statusKey = `status_bed_${activeCol}`;

        for (const p of patients) {
            let ward = '';
            let bed = '';
            let statusVal = '';

            if (p[wardKey] !== undefined || p[statusKey] !== undefined) {
                ward = String(p[wardKey] || '').trim().replace('A', '');
                bed = String(p[bedKey] || '').trim();
                statusVal = String(p[statusKey] || '').trim();
            } else {
                ward = String(p.assigned_ward || '').trim().replace('A', '');
                bed = String(p.assigned_bed || '').trim();
                statusVal = String(p.status_bed || '').trim();
            }

            const sLower = statusVal.toLowerCase();
            if (sLower.includes('delay') || statusVal === '待簽床' || statusVal === '-' || statusVal === '待排') {
                continue;
            }

            if (!ward || !bed) {
                const parsed = typeof ExcelPatientParser !== 'undefined' ? ExcelPatientParser.parsePreassignedBed(statusVal) : null;
                if (parsed) {
                    ward = parsed.wardClean || (parsed[0] ? String(parsed[0]).replace('A', '') : '');
                    bed = parsed.bedNum || (parsed[1] ? String(parsed[1]) : '');
                } else if (statusVal) {
                    const mVip = statusVal.match(/\b(192|119|129)\b/);
                    if (mVip) {
                        ward = mVip[1];
                        bed = mVip[1];
                    }
                }
            }

            if (ward && bed) {
                const bedClean = /^\d+$/.test(bed) ? String(parseInt(bed, 10)) : bed;
                occupied[`${ward}-${bedClean}`] = p;
                occupied[`${ward}-${bed}`] = p;
            }
        }
        return occupied;
    }

    /**
     * 更新各病房床位輸入框內的數字背景高亮 (嚴格重現 bed_analyzer.pyw: highlight_beds)
     * 男病人入住: 藍底白字 (.occ-m #2563eb)
     * 女病人入住: 紅底白字 (.occ-f #dc2626)
     * 未佔用/正常: 黑色無背景
     */
    updateBedInputHighlights(ward) {
        const occMap = this.getOccupiedBedMap(this.selectedSchemeCol || 1);
        const occupiedBedsInWard = {};

        for (const key of Object.keys(occMap)) {
            if (key.startsWith(`${ward}-`)) {
                const bStr = key.replace(`${ward}-`, '');
                const p = occMap[key];
                occupiedBedsInWard[bStr] = (p && p.gender) ? p.gender : 'M';
            }
        }

        BedConfigManager.CATEGORIES.forEach(cat => {
            const input = document.getElementById(`input-${ward}-${cat}`);
            const backdrop = document.getElementById(`backdrop-${ward}-${cat}`);
            if (!input || !backdrop) return;

            const text = input.value || '';
            if (!text) {
                backdrop.innerHTML = '';
                return;
            }

            // 解析數字與非數字區段
            const parts = text.split(/(\b\d+\b)/);
            let html = '';

            for (const part of parts) {
                if (/^\d+$/.test(part)) {
                    const cleanB = String(parseInt(part, 10));
                    const gender = occupiedBedsInWard[cleanB] || occupiedBedsInWard[part];
                    if (gender) {
                        const gUpper = String(gender).toUpperCase();
                        const isFemale = (gUpper === 'F' || gUpper === '女');
                        const hlClass = isFemale ? 'occ-f' : 'occ-m';
                        html += `<span class="bed-hl ${hlClass}">${part}</span>`;
                    } else {
                        html += `<span class="bed-hl occ-normal">${part}</span>`;
                    }
                } else if (part) {
                    const escaped = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    html += `<span class="bed-hl-text">${escaped}</span>`;
                }
            }

            backdrop.innerHTML = html;
            backdrop.scrollLeft = input.scrollLeft;
        });
    }

    updateAllWardHighlights() {
        BedConfigManager.STANDARD_WARDS.forEach(w => {
            this.updateWardStatsAndChips(w);
            this.updateBedInputHighlights(w);
        });
    }

    updateWardStatsAndChips(ward) {
        let totalCount = 0;
        const chipsContainer = document.getElementById(`chips-${ward}`);
        if (chipsContainer) chipsContainer.innerHTML = '';

        const selCol = this.selectedSchemeCol || 1;
        const occMap = this.getOccupiedBedMap(selCol);
        let occupiedCount = 0;

        BedConfigManager.CATEGORIES.forEach(cat => {
            const bedStr = this.manager.getInput(ward, cat);
            if (!bedStr) return;

            const bNums = parseBedString(bedStr);
            if (cat !== '留床') {
                totalCount += bNums.length;
            }

            if (chipsContainer) {
                bNums.forEach(bNum => {
                    const bNumStr = String(bNum);
                    const cleanB = /^\d+$/.test(bNumStr) ? String(parseInt(bNumStr, 10)) : bNumStr;
                    const bedInfo = this.manager.lookupBed(ward, bNum, cat);
                    const occPatient = occMap[`${ward}-${cleanB}`] || occMap[`${ward}-${bNumStr}`];
                    if (occPatient) occupiedCount++;

                    const chip = document.createElement('span');
                    let occClass = 'vacant';
                    if (occPatient) {
                        occClass = (occPatient.gender === 'F' || occPatient.gender === '女') ? 'occupied occupied-female' : 'occupied occupied-male';
                    }
                    chip.className = `bed-chip ${occClass}`;
                    if (bedInfo.leave_status && bedInfo.leave_status.includes('請假')) {
                        chip.classList.add('on-leave');
                    }

                    const docLabel = bedInfo.doctor_name !== "未指定醫師" ? bedInfo.doctor_name : "";
                    const occText = occPatient ? ` (${occPatient.name})` : (docLabel ? ` · ${docLabel}` : "");
                    chip.textContent = `${cat} ${bNum}${occText}`;
                    chip.title = `${ward}病房 ${bNum}床 [${cat}] | 主治: ${bedInfo.doctor_name} (${bedInfo.doctor_code || '無代碼'}) | 狀態: ${bedInfo.leave_status} ${occPatient ? `| 已排病人: ${occPatient.name} (${occPatient.chart_no}) [排床${selCol}]` : ''}`;

                    chipsContainer.appendChild(chip);
                });
            }
        });

        const cntEl = document.getElementById(`count-${ward}`);
        if (cntEl) cntEl.textContent = `合計: ${totalCount} 床`;
        const occEl = document.getElementById(`occupied-${ward}`);
        if (occEl) occEl.textContent = `有人住: ${occupiedCount} 床`;
    }

    /**
     * 儲存格就地雙擊直接編輯 (Excel 模式，不彈出視窗)
     */
    makeCellEditable(td, rowIdxOrChartNo, colKey) {
        if (!td || td.querySelector('.cell-inline-editor')) return;

        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        let patient = null;
        if (typeof rowIdxOrChartNo === 'number') {
            patient = patients.find(p => p.row_idx === rowIdxOrChartNo) || patients[rowIdxOrChartNo - 1];
        } else if (typeof rowIdxOrChartNo === 'string') {
            patient = patients.find(p => p.chart_no === rowIdxOrChartNo || String(p.row_idx) === rowIdxOrChartNo);
        }
        if (!patient) return;

        const origHtml = td.innerHTML;
        let currentVal = '';
        if (patient[colKey] !== undefined) {
            currentVal = String(patient[colKey]).trim();
        } else if (colKey.startsWith('status_bed_')) {
            currentVal = String(patient.status_bed || '').trim();
        }

        td.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell-inline-editor';
        input.value = currentVal;
        td.appendChild(input);
        input.focus();
        input.select();

        let committed = false;

        const commit = () => {
            if (committed) return;
            committed = true;
            const newVal = input.value.trim();
            if (newVal === currentVal) {
                td.innerHTML = origHtml;
                return;
            }
            this.saveInlineCellEdit(patient, colKey, newVal, origHtml, td);
        };

        const cancel = () => {
            if (committed) return;
            committed = true;
            td.innerHTML = origHtml;
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        });
    }

    saveInlineCellEdit(patient, colKey, newVal, origHtml, td) {
        this.pushUndoSnapshot();

        if (colKey === 'bed_pref' || colKey === 'raw_pref') {
            patient.bed_pref = newVal;
            patient.normalized_pref = BedAssignmentEngine.getNormalizedPreference(newVal);
            this.renderAllTables();
            this.showToast(`已更新「${patient.name || '病人'}」房型意願為【${newVal}】，校正後意願已同步更新為【${patient.normalized_pref}】！`, "success");
        } else if (colKey === 'normalized_pref') {
            patient.normalized_pref = newVal;
            this.renderAllTables();
            this.showToast(`已更新「${patient.name || '病人'}」校正後意願為【${newVal}】！`, "success");
        } else if (['status_bed', 'status_bed_1', 'status_bed_2', 'status_bed_3', 'status_bed_4'].includes(colKey)) {
            // 床位欄位編輯（對齊 bed_analyzer: 檢查借床、自動校正代班燈號、四欄同步更新）
            let formattedBed = newVal;
            const pre = typeof ExcelPatientParser !== 'undefined' ? ExcelPatientParser.parsePreassignedBed(newVal) : null;
            if (pre) {
                const wName = pre.wardClean || pre.ward || pre[0];
                const bNum = pre.bedNum || pre[1];
                const bInfo = this.manager.lookupBed(wName, parseInt(bNum, 10));
                if (bInfo && !/\(.*?\)/.test(newVal)) {
                    const pClean = String(patient.doc_code || '').replace(/\D/g, '');
                    const bDoc = String(bInfo.clean_doc_code || '').replace(/\D/g, '');
                    const proxyName = bInfo.proxy_doctor || '';
                    const proxyDoc = proxyName ? this.manager.lookupDoctorByName(proxyName) : null;
                    const proxyC = proxyDoc ? String(proxyDoc.code || '').replace(/\D/g, '') : '';
                    if (pClean !== bDoc) {
                        const effCode = proxyC || bDoc;
                        if (effCode) formattedBed = `${wName}-${bNum} (${effCode})`;
                    } else if (proxyC) {
                        formattedBed = `${wName}-${bNum} (${proxyC})`;
                    }
                }
                for (let k = 1; k <= 4; k++) {
                    patient[`assigned_ward_${k}`] = wName;
                    patient[`assigned_bed_${k}`] = bNum;
                }
                patient.assigned_ward = wName;
                patient.assigned_bed = bNum;
            } else {
                const mVip = newVal.match(/\b(192|119|129)\b/);
                if (mVip) {
                    const vipRm = mVip[1];
                    for (let k = 1; k <= 4; k++) {
                        patient[`assigned_ward_${k}`] = vipRm;
                        patient[`assigned_bed_${k}`] = vipRm;
                    }
                    patient.assigned_ward = vipRm;
                    patient.assigned_bed = vipRm;
                } else {
                    for (let k = 1; k <= 4; k++) {
                        patient[`assigned_ward_${k}`] = '';
                        patient[`assigned_bed_${k}`] = '';
                    }
                    patient.assigned_ward = '';
                    patient.assigned_bed = '';
                }
            }

            const isAss = Boolean(formattedBed && !formattedBed.toLowerCase().includes('delay') && !['待簽床', '-', '無', '待重排', '待排'].includes(formattedBed));
            for (let k = 1; k <= 4; k++) {
                patient[`status_bed_${k}`] = formattedBed;
                patient[`is_assigned_${k}`] = isAss;
                patient[`is_manual_assigned_${k}`] = isAss;
            }
            patient.status_bed = formattedBed;
            patient.raw_status_bed = formattedBed;
            delete patient.bed_lock_restore;
            patient.is_bed_locked = isAss;
            patient.initial_delay_days = (typeof ExcelPatientParser !== 'undefined')
                ? ExcelPatientParser.extractDelayDays(formattedBed)
                : 0;
            patient.is_assigned = isAss;
            patient.is_manual_assigned = isAss;

            this.updateAllWardHighlights();
            this.updateGlobalStatusBar();
            this.renderAllTables();
            this.showToast(`已更新「${patient.name || '病人'}」床位為【${formattedBed}】（已設為手動最終結果）！`, "success");
        } else if (colKey === 'gender') {
            const g = newVal.toUpperCase();
            patient.gender = (g.includes('男') || g === 'M') ? 'M' : 'F';
            this.renderAllTables();
            this.updateAllWardHighlights();
            this.updateGlobalStatusBar();
            this.showToast(`已更新「${patient.name || '病人'}」性別為【${patient.gender === 'M' ? '男' : '女'}】`, "success");
        } else if (colKey === 'doc_code') {
            patient.doc_code = newVal;
            const cleanDigits = newVal.replace(/\D/g, '');
            const doc = cleanDigits ? this.manager.lookupDoctorByCode(cleanDigits) : null;
            if (doc) {
                patient.doctor = doc.name;
                patient.doctor_name = doc.name;
            }
            this.renderAllTables();
            this.showToast(`已更新「${patient.name || '病人'}」醫師燈號為【${newVal}】${doc ? ` (${doc.name})` : ''}`, "success");
        } else if (colKey === 'doctor') {
            patient.doctor = newVal;
            patient.doctor_name = newVal;
            const doc = this.manager.lookupDoctorByName(newVal);
            if (doc && doc.code) {
                patient.doc_code = doc.code;
            }
            this.renderAllTables();
            this.showToast(`已更新「${patient.name || '病人'}」主治醫師為【${newVal}】${doc ? ` (${doc.code})` : ''}`, "success");
        } else {
            patient[colKey] = newVal;
            this.renderAllTables();
            this.showToast(`已儲存「${patient.name || '病人'}」修改`, "success");
        }

        this.manager.saveToLocalStorage();
    }

    /**
     * 各病房主治醫師與配床表儲存格就地雙擊直接編輯 (Excel 模式，不彈出視窗)
     */
    makeDoctorCellEditable(td, arg1, arg2, arg3, arg4) {
        if (!td || td.querySelector('.cell-inline-editor')) return;

        let ward = '';
        let docCode = '';
        let docName = '';
        let colKey = '';

        if (arg4 !== undefined) {
            ward = arg1;
            docCode = arg2;
            docName = arg3;
            colKey = arg4;
        } else {
            colKey = arg1;
            const tr = td.closest('tr');
            if (tr) {
                ward = tr.getAttribute('data-ward') || '';
                docCode = tr.getAttribute('data-code') || '';
                docName = tr.getAttribute('data-name') || '';
            }
        }

        const normWard = this.manager._normalizeWardName(ward);
        let currentWardKey = normWard;
        let doc = null;

        if (this.manager.data && this.manager.data.wards && this.manager.data.wards[normWard]) {
            doc = (this.manager.data.wards[normWard].doctors || []).find(d =>
                (docCode && String(d.code) === String(docCode)) ||
                (docName && d.name === docName)
            );
        }
        if (!doc && this.manager.data && this.manager.data.wards) {
            for (const [wKey, wData] of Object.entries(this.manager.data.wards)) {
                const found = (wData.doctors || []).find(d =>
                    (docCode && String(d.code) === String(docCode)) ||
                    (docName && d.name === docName)
                );
                if (found) {
                    doc = found;
                    currentWardKey = wKey;
                    ward = String(wKey).replace('A', '');
                    break;
                }
            }
        }
        if (!doc) return;

        const origHtml = td.innerHTML;
        let currentVal = '';
        if (colKey === 'ward') {
            currentVal = String(ward).replace('A', '');
        } else if (colKey === 'name') {
            currentVal = doc.name || '';
        } else if (colKey === 'code') {
            currentVal = doc.code || '';
        } else if (colKey === 'bed_str') {
            currentVal = doc.bed_str || '';
        } else if (colKey === 'leave') {
            if (doc.leave_info) {
                currentVal = `${doc.leave_info.period} 由 ${doc.leave_info.proxy} 代理`;
            } else {
                currentVal = '';
            }
        }

        td.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell-inline-editor';
        input.value = currentVal;
        td.appendChild(input);
        input.focus();
        input.select();

        let committed = false;

        const commit = () => {
            if (committed) return;
            committed = true;
            const newVal = input.value.trim();
            if (newVal === currentVal) {
                td.innerHTML = origHtml;
                return;
            }
            this.saveDoctorInlineCellEdit(ward, docCode, docName, colKey, newVal, origHtml, td);
        };

        const cancel = () => {
            if (committed) return;
            committed = true;
            td.innerHTML = origHtml;
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
            }
        });
    }

    saveDoctorInlineCellEdit(ward, docCode, docName, colKey, newVal, origHtml, td) {
        this.pushUndoSnapshot();

        if (!this.manager.data) this.manager.data = { wards: {}, leaves: [] };
        if (!this.manager.data.wards) this.manager.data.wards = {};
        if (!this.manager.data.leaves) this.manager.data.leaves = [];

        const normWard = this.manager._normalizeWardName(ward);
        let currentWardKey = normWard;
        let doc = null;

        if (this.manager.data.wards[normWard] && this.manager.data.wards[normWard].doctors) {
            doc = this.manager.data.wards[normWard].doctors.find(d => String(d.code) === String(docCode) || d.name === docName);
        }
        if (!doc) {
            for (const [wKey, wData] of Object.entries(this.manager.data.wards)) {
                const found = (wData.doctors || []).find(d => String(d.code) === String(docCode) || d.name === docName);
                if (found) {
                    doc = found;
                    currentWardKey = wKey;
                    break;
                }
            }
        }

        if (!doc) {
            td.innerHTML = origHtml;
            return;
        }

        const oldName = doc.name;
        const oldCode = doc.code;

        if (colKey === 'ward') {
            const cleanTargetWard = newVal.replace(/\D/g, '') || newVal.trim();
            if (!cleanTargetWard) {
                td.innerHTML = origHtml;
                return;
            }
            const targetNormWard = this.manager._normalizeWardName(cleanTargetWard);
            if (targetNormWard !== currentWardKey) {
                if (this.manager.data.wards[currentWardKey]) {
                    this.manager.data.wards[currentWardKey].doctors = (this.manager.data.wards[currentWardKey].doctors || []).filter(d => d !== doc);
                }
                if (!this.manager.data.wards[targetNormWard]) {
                    this.manager.data.wards[targetNormWard] = { doctors: [], categories: {} };
                }
                if (!this.manager.data.wards[targetNormWard].doctors) {
                    this.manager.data.wards[targetNormWard].doctors = [];
                }
                this.manager.data.wards[targetNormWard].doctors.push(doc);
            }
            this.showToast(`已將醫師 ${doc.name} 移至 ${cleanTargetWard} 病房`, "success");
        } else if (colKey === 'name') {
            if (!newVal) {
                this.showToast("醫師姓名不可為空！", "warning");
                td.innerHTML = origHtml;
                return;
            }
            doc.name = newVal;
            if (doc.leave_info && doc.leave_info.doctor === oldName) {
                doc.leave_info.doctor = newVal;
            }
            this.manager.data.leaves.forEach(l => {
                if (l.doctor === oldName) l.doctor = newVal;
                if (l.proxy === oldName) l.proxy = newVal;
            });
            (this.manager.patientData?.patients || []).forEach(p => {
                if (p.doctor === oldName || String(p.doc_code).replace(/\D/g, '') === String(doc.code).replace(/\D/g, '')) {
                    p.doctor = newVal;
                }
            });
            this.showToast(`已更新醫師姓名為【${newVal}】`, "success");
        } else if (colKey === 'code') {
            if (!newVal) {
                this.showToast("醫師燈號不可為空！", "warning");
                td.innerHTML = origHtml;
                return;
            }
            doc.code = newVal;
            doc.clean_code = String(newVal).replace(/\D/g, '');
            (this.manager.patientData?.patients || []).forEach(p => {
                if (p.doctor === doc.name || String(p.doc_code).replace(/\D/g, '') === String(oldCode).replace(/\D/g, '')) {
                    p.doc_code = newVal;
                }
            });
            this.showToast(`已更新醫師燈號為【${newVal}】`, "success");
        } else if (colKey === 'bed_str') {
            doc.bed_str = newVal;
            doc.beds = (typeof parseBedString === 'function') ? parseBedString(newVal) : [];
            this.showToast(`已更新醫師 ${doc.name} 專屬配床為【${newVal || '無'}】`, "success");
        } else if (colKey === 'leave') {
            const cleanLeave = newVal.trim();
            if (!cleanLeave || cleanLeave === '在勤' || cleanLeave === '-' || cleanLeave === '無') {
                doc.leave_info = null;
                this.manager.data.leaves = this.manager.data.leaves.filter(l => l.doctor !== doc.name && l.doctor !== oldName);
                this.showToast(`已更新醫師 ${doc.name} 差勤狀態為【在勤】`, "success");
            } else {
                const m = cleanLeave.match(/(\S+)\s*由\s*(\S+)\s*代理/);
                let leaveInfo = null;
                if (m) {
                    leaveInfo = { doctor: doc.name, period: m[1], proxy: m[2], raw: `${doc.name}醫師 ${m[1]} 請假，由 ${m[2]} 醫師代理` };
                } else {
                    leaveInfo = { doctor: doc.name, period: cleanLeave, proxy: "未知", raw: `${doc.name}醫師 ${cleanLeave} 請假` };
                }
                doc.leave_info = leaveInfo;
                this.manager.data.leaves = this.manager.data.leaves.filter(l => l.doctor !== doc.name && l.doctor !== oldName);
                this.manager.data.leaves.push(leaveInfo);
                this.showToast(`已設定醫師 ${doc.name} 請假代理：${leaveInfo.raw}`, "success");
            }
        }

        this.manager.applyLeaves();
        this.manager.normalizePatientBeds();
        this.renderDoctorsTab();
        this.updateAllWardHighlights();
        this.manager.saveToLocalStorage();
    }

    updateGlobalStatusBar() {
        const availableBeds = this.getAvailableBeds();
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];

        const totalBeds = availableBeds.length;
        const totalPts = patients.length;
        const selCol = this.selectedSchemeCol || 1;
        const assignedPts = patients.filter(p => (p[`is_assigned_${selCol}`] !== undefined ? p[`is_assigned_${selCol}`] : p.is_assigned)).length;
        const pendingPts = totalPts - assignedPts;
        const maleCount = patients.filter(p => p.gender === 'M').length;
        const femaleCount = patients.filter(p => p.gender === 'F').length;

        if (this.statTotalBeds) this.statTotalBeds.textContent = totalBeds;
        if (this.statTotalPatients) this.statTotalPatients.textContent = totalPts;
        if (this.statAssignedPatients) this.statAssignedPatients.textContent = assignedPts;
        if (this.statPendingPatients) this.statPendingPatients.textContent = pendingPts;
        if (this.statGenderCount) this.statGenderCount.textContent = `男 ${maleCount} / 女 ${femaleCount}`;

        this.updateSchemeVacancies(availableBeds, patients);
    }

    /** 更新主畫面與病人名單四個排床方案的剩餘空床數。 */
    updateSchemeVacancies(availableBeds, patients) {
        const normalizeBedNum = (bed) => {
            const value = String(bed || '').trim();
            return /^\d+$/.test(value) ? String(parseInt(value, 10)) : value;
        };
        const countableBedKeys = new Set(availableBeds.map(b =>
            `${String(b.ward || '').replace('A', '')}-${normalizeBedNum(b.bed_num)}`
        ));
        // 留床會顯示在空床數中，但不加入 getAvailableBeds()，因此不會被自動排床使用。
        this.getReservedBedKeys().forEach(bedKey => countableBedKeys.add(bedKey));

        for (let schemeIdx = 1; schemeIdx <= 4; schemeIdx++) {
            const occupiedBedKeys = new Set();
            let delayCount = 0;

            patients.forEach(p => {
                const statusBed = String(p[`status_bed_${schemeIdx}`] !== undefined ? p[`status_bed_${schemeIdx}`] : (p.status_bed || '')).trim();
                const isAssigned = p[`is_assigned_${schemeIdx}`] !== undefined
                    ? p[`is_assigned_${schemeIdx}`]
                    : p.is_assigned;

                // 統計 delay 數量：狀態欄位包含 delay 或 延後
                if (statusBed.toLowerCase().includes('delay') || statusBed.includes('延後')) {
                    delayCount++;
                }

                if (!isAssigned) return;

                const ward = String(p[`assigned_ward_${schemeIdx}`] || p.assigned_ward || '').replace('A', '');
                const bed = normalizeBedNum(p[`assigned_bed_${schemeIdx}`] || p.assigned_bed || '');
                const bedKey = `${ward}-${bed}`;

                // 僅扣除院內可用／留床的床位；VIP／他科借床不影響此數字。
                if (countableBedKeys.has(bedKey)) occupiedBedKeys.add(bedKey);
            });

            const emptyBeds = Math.max(0, countableBedKeys.size - occupiedBedKeys.size);
            const vacancyText = `(空床:${emptyBeds} delay:${delayCount})`;
            ['scheme-vacancy', 'patients-scheme-vacancy'].forEach(prefix => {
                const element = document.getElementById(`${prefix}-${schemeIdx}`);
                if (element) element.textContent = vacancyText;
            });
        }
    }

    /** 判斷此病人的床位是否已被手動鎖定（包含匯入時原本已填妥的床位）。 */
    isBedLocked(patient) {
        const rawStatus = String(patient.raw_status_bed || '').trim();
        const hasImportedBed = Boolean(
            rawStatus && !rawStatus.toLowerCase().includes('delay') && !rawStatus.includes('待') && !['-', '無'].includes(rawStatus)
        );
        return Boolean(patient.is_bed_locked || patient.is_manual_assigned || hasImportedBed);
    }

    /** 將指定方案的床位鎖定到四個方案，或解除鎖定並回復鎖定前結果。 */
    toggleBedLock(rowIdx, schemeIdx) {
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        const patient = patients.find(p => p.row_idx === rowIdx) || patients[rowIdx - 1];
        if (!patient) return;

        if (this.isBedLocked(patient)) {
            this.pushUndoSnapshot();
            if (patient.bed_lock_restore) {
                Object.assign(patient, patient.bed_lock_restore);
                delete patient.bed_lock_restore;
            } else {
                // 匯入時已有的床位沒有「鎖定前方案」可回復，僅解除其手動鎖定屬性。
                patient.is_bed_locked = false;
                patient.is_manual_assigned = false;
                patient.raw_status_bed = '';
            }
            this.showToast(`已解除「${patient.name || '病人'}」的床位鎖定；下次自動排床可重新安排。`, 'info');
        } else {
            const statusBed = String(patient[`status_bed_${schemeIdx}`] || patient.status_bed || '').trim();
            const isAssigned = patient[`is_assigned_${schemeIdx}`] !== undefined
                ? patient[`is_assigned_${schemeIdx}`]
                : patient.is_assigned;
            if (!isAssigned || !statusBed || statusBed.toLowerCase().includes('delay') || statusBed.includes('待')) {
                this.showToast('僅能鎖定已排定的床位。', 'warning');
                return;
            }

            this.pushUndoSnapshot();

            patient.bed_lock_restore = {
                status_bed: patient.status_bed,
                raw_status_bed: patient.raw_status_bed,
                initial_delay_days: patient.initial_delay_days,
                is_assigned: patient.is_assigned,
                assigned_ward: patient.assigned_ward,
                assigned_bed: patient.assigned_bed,
                is_manual_assigned: patient.is_manual_assigned,
                is_bed_locked: patient.is_bed_locked
            };
            for (let k = 1; k <= 4; k++) {
                patient.bed_lock_restore[`status_bed_${k}`] = patient[`status_bed_${k}`];
                patient.bed_lock_restore[`is_assigned_${k}`] = patient[`is_assigned_${k}`];
                patient.bed_lock_restore[`assigned_ward_${k}`] = patient[`assigned_ward_${k}`];
                patient.bed_lock_restore[`assigned_bed_${k}`] = patient[`assigned_bed_${k}`];
            }

            const ward = patient[`assigned_ward_${schemeIdx}`] || patient.assigned_ward || '';
            const bed = patient[`assigned_bed_${schemeIdx}`] || patient.assigned_bed || '';
            for (let k = 1; k <= 4; k++) {
                patient[`status_bed_${k}`] = statusBed;
                patient[`is_assigned_${k}`] = true;
                patient[`assigned_ward_${k}`] = ward;
                patient[`assigned_bed_${k}`] = bed;
            }
            patient.status_bed = statusBed;
            patient.raw_status_bed = statusBed;
            patient.is_assigned = true;
            patient.assigned_ward = ward;
            patient.assigned_bed = bed;
            patient.is_manual_assigned = true;
            patient.is_bed_locked = true;
            this.showToast(`已鎖定「${patient.name || '病人'}」至 ${statusBed}；四個方案與後續自動排床都會保留此床位。`, 'success');
        }

        this.updateAllWardHighlights();
        this.updateGlobalStatusBar();
        this.renderAllTables();
        this.manager.saveToLocalStorage();
    }

    /* ==========================================================================
       排床方案切換、床位排序與剪貼簿直向複製
       ========================================================================== */
    formatSchemeCell(p, schemeIdx) {
        const statusBed = String(p[`status_bed_${schemeIdx}`] || (p.is_assigned ? p.status_bed : '') || '').trim() || '待排';
        const isAssigned = p[`is_assigned_${schemeIdx}`] !== undefined ? p[`is_assigned_${schemeIdx}`] : p.is_assigned;
        const isActive = this.selectedSchemeCol === schemeIdx;

        let cellClass = 'scheme-cell editable-cell';
        if (isActive) cellClass += ' active-col';
        const isLocked = this.isBedLocked(p);

        let content = '';
        if (isAssigned) {
            if (isLocked) cellClass += ' locked';
            if (['192', '119', '129'].some(v => statusBed.includes(v))) {
                cellClass += ' assigned';
                content = `<span class="badge badge-vip">${statusBed}</span>`;
            } else {
                cellClass += ' assigned';
                content = `<span class="badge badge-assigned">${statusBed}</span>`;
            }
        } else if (statusBed.toLowerCase().includes('delay') || statusBed.includes('延後')) {
            const isUrgent = String(p.arrival || '').includes('準時');
            if (isUrgent) {
                cellClass += ' delayed-ontime';
                content = `<span class="badge" style="background:#fee2e2; color:#991b1b; border:1px solid #f87171; font-weight:700;">⚠️ ${statusBed}</span>`;
            } else {
                cellClass += ' delayed';
                content = `<span class="badge badge-delayed">${statusBed}</span>`;
            }
        } else {
            content = `<span class="badge badge-pending">${statusBed}</span>`;
        }

        const origIdx = p.row_idx !== undefined ? p.row_idx : (p.chart_no ? `'${p.chart_no}'` : 'null');
        const lockTitle = isAssigned
            ? (isLocked ? '點擊深綠色外框可解除床位鎖定；雙擊床位文字可編輯' : '點擊淺綠色外框可鎖定此床位；雙擊床位文字可編輯')
            : `雙擊可直接就地編輯排床${schemeIdx}`;
        return `<td class="${cellClass}" data-patient-row="${origIdx}" data-scheme-idx="${schemeIdx}" title="${lockTitle}" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'status_bed_${schemeIdx}')">${content}</td>`;
    }

    getPatientBedSortKey(p, schemeIdx, origIdx) {
        const stVal = String(p[`status_bed_${schemeIdx}`] || p.status_bed || '').trim();

        // 1. 核心病房與床號 (113, 121, 122, 123, 124)
        const pre = ExcelPatientParser.parsePreassignedBed(stVal);
        if (pre) {
            const [wStr, bStr] = pre;
            const wNum = parseInt(String(wStr).replace(/\D/g, ''), 10) || 999;
            const bNum = parseInt(String(bStr).replace(/\D/g, ''), 10) || 0;
            return [0, wNum, bNum, origIdx];
        }

        // 2. 特殊房型 (119, 129, 192)
        const mVip = stVal.match(/\b(119|129|192)\b/);
        if (mVip) {
            const vipNum = parseInt(mVip[1], 10) || 999;
            return [1, vipNum, 0, origIdx];
        }

        // 3. 延後 delay
        if (stVal.toLowerCase().includes('delay') || stVal.includes('延後')) {
            const mDelay = stVal.match(/delay\s*(\d+)/i);
            const dDays = mDelay ? parseInt(mDelay[1], 10) : 1;
            return [2, dDays, 0, origIdx];
        }

        // 4. 待排床
        return [3, 0, 0, origIdx];
    }

    compareBedSortKeys(k1, k2) {
        for (let i = 0; i < k1.length; i++) {
            if (k1[i] < k2[i]) return -1;
            if (k1[i] > k2[i]) return 1;
        }
        return 0;
    }

    toggleRtBedSort() {
        this.rtBedSortActive = !this.rtBedSortActive;
        const schemeIdx = this.selectedSchemeCol || 1;

        const btn1 = document.getElementById('btn-rt-sort-bed');
        const btn2 = document.getElementById('btn-patients-sort-bed');

        if (this.rtBedSortActive) {
            const text = `↺ 恢復原狀 (排床${schemeIdx}排序中)`;
            if (btn1) {
                btn1.textContent = text;
                btn1.classList.add('btn-sort-active');
            }
            if (btn2) {
                btn2.textContent = text;
                btn2.classList.add('btn-sort-active');
            }
            this.renderAllTables();
            this.showToast(`主表格已按「排床${schemeIdx}」床位順序 (113➔124) 排列！\n再次點擊按鈕即可恢復原狀。`, "info");
        } else {
            const text1 = "↕️ 依床位排序 (113➔124)";
            const text2 = "↕️ 依床位排序";
            if (btn1) {
                btn1.textContent = text1;
                btn1.classList.remove('btn-sort-active');
            }
            if (btn2) {
                btn2.textContent = text2;
                btn2.classList.remove('btn-sort-active');
            }
            this.renderAllTables();
            this.showToast("主表格已恢復原本病人順序！", "info");
        }
    }

    selectBedSchemeColumn(schemeIdx) {
        this.selectedSchemeCol = schemeIdx;

        const schemeNames = {
            1: "方案 1 (原本排法/基準)",
            2: "方案 2 (雙空依性別缺額優先)",
            3: "方案 3 (全域二分圖最大匹配)",
            4: "方案 4 (步驟2本床後全域二分圖/推薦)"
        };
        const name = schemeNames[schemeIdx] || `方案 ${schemeIdx}`;

        // 同步設定目前病人的主狀態為所選方案
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        patients.forEach(p => {
            if (p[`status_bed_${schemeIdx}`] !== undefined) {
                p.status_bed = p[`status_bed_${schemeIdx}`];
                p.assigned_ward = p[`assigned_ward_${schemeIdx}`] || '';
                p.assigned_bed = p[`assigned_bed_${schemeIdx}`] || '';
                p.is_assigned = Boolean(p[`is_assigned_${schemeIdx}`]);
            }
        });

        // 更新 Header 高亮
        for (let i = 1; i <= 4; i++) {
            const th1 = document.getElementById(`th-scheme-${i}`);
            if (th1) th1.classList.toggle('active-scheme', i === schemeIdx);
            const th2 = document.getElementById(`th-p-scheme-${i}`);
            if (th2) th2.classList.toggle('active-scheme', i === schemeIdx);
        }

        // 更新上方狀態文字
        const lbl = document.getElementById('lbl-applied-strategy');
        if (lbl) {
            lbl.textContent = `各病房床位顯示中: 【${name}】`;
        }

        if (this.rtBedSortActive) {
            const btn1 = document.getElementById('btn-rt-sort-bed');
            const btn2 = document.getElementById('btn-patients-sort-bed');
            if (btn1) btn1.textContent = `↺ 恢復原狀 (排床${schemeIdx}排序中)`;
            if (btn2) btn2.textContent = `↺ 恢復原狀 (排床${schemeIdx}排序中)`;
        }

        // 觸發各病房床位輸入介面之變色呈現 (高亮與 Chips 同步)
        this.updateAllWardHighlights();
        this.updateGlobalStatusBar();
        this.renderAllTables();

        this.showToast(`已切換床位顯示方案為【${name}】！\n各病房輸入介面與床位預覽已即時更新入住床位色彩。`, "info");
    }

    copyStatusBedColumn(schemeIdx) {
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        if (patients.length === 0) {
            this.showToast("目前尚未載入任何病人資料！", "warning");
            return;
        }

        const schemeNames = {
            1: "方案 1 (原本排法/基準)",
            2: "方案 2 (雙空依性別缺額優先)",
            3: "方案 3 (全域二分圖最大匹配)",
            4: "方案 4 (步驟2本床後全域二分圖/推薦)"
        };
        const schemeName = schemeNames[schemeIdx] || `方案 ${schemeIdx}`;
        const fieldKey = `status_bed_${schemeIdx}`;

        // 複製全部病人（嚴格維持原始第 1 筆到第 N 筆的原始順序）
        const statusValues = patients.map(p => {
            const statusRaw = String(p[fieldKey] || p.status_bed || '');
            return statusRaw.replace(/[\r\n]+/g, ' ').trim();
        });

        const text = statusValues.join('\r\n');
        this.writeClipboardText(text)
            .then(() => {
                this.showToast(`已複製【全部 ${statusValues.length} 位病人】之「排床${schemeIdx}」整欄（${schemeName}）！\n可直接在 Google Sheet / Excel 按 Ctrl+V 直向貼上`, "success");
            })
            .catch(err => {
                console.error(err);
                this.showToast(`複製失敗: ${err.message}`, "error");
            });
    }

    copyPatientSummary() {
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        if (patients.length === 0) {
            this.showToast("目前尚未載入任何病人名單！", "warning");
            return;
        }

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const timeStr = `${yyyy}-${mm}-${dd} ${hh}:${min}`;

        const lines = [];
        lines.push("【入院病人名單摘要】");
        lines.push(`產出時間: ${timeStr}`);
        lines.push("=".repeat(45));

        patients.forEach(p => {
            const docObj = this.manager.lookupDoctorByCode(p.doc_code || '');
            const docName = (docObj && docObj.name) ? docObj.name : (p.doc_code || '未指定');
            const st1 = p.status_bed_1 || p.status_bed || '待排';
            const st2 = p.status_bed_2 || p.status_bed || '待排';
            const st3 = p.status_bed_3 || p.status_bed || '待排';
            const st4 = p.status_bed_4 || p.status_bed || '待排';
            const prefRaw = p.bed_pref || '';
            const prefNorm = p.normalized_pref || BedAssignmentEngine.getNormalizedPreference(prefRaw);
            const prefStr = prefRaw ? `${prefRaw} (校正:${prefNorm})` : `無 (校正:${prefNorm})`;

            lines.push(`[排1:${st1} | 排2:${st2} | 排3:${st3} | 排4:${st4}] ${p.name || ''} (${p.gender === 'M' ? '男' : '女'}, ${p.chart_no || ''}) -> ${docName} 醫師 | 意願:${prefStr} | 診斷:${p.diagnosis || ''}`);
        });

        const text = lines.join('\n');
        this.writeClipboardText(text)
            .then(() => {
                this.showToast(`已成功複製 ${patients.length} 位病人完整簽床名單摘要！`, "success");
            })
            .catch(err => {
                this.showToast(`複製失敗: ${err.message}`, "error");
            });
    }

    async writeClipboardText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch (e) {
                // Fallback below
            }
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }

    /* ==========================================================================
       表格渲染
       ========================================================================== */
    renderAllTables() {
        this.renderLivePatientsTable();
        this.renderFullPatientsTable();
    }

    renderLivePatientsTable() {
        if (!this.livePatientsTbody) return;
        this.livePatientsTbody.innerHTML = '';

        let patients = (this.manager.patientData && this.manager.patientData.patients) ? [...this.manager.patientData.patients] : [];
        if (patients.length === 0) {
            this.livePatientsTbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding: 24px; color: var(--text-dim);">目前尚無入院病人資料，請點擊上方按鈕導入 Excel 或從剪貼簿貼上</td></tr>`;
            return;
        }

        // 床位排序
        if (this.rtBedSortActive) {
            const schemeIdx = this.selectedSchemeCol || 1;
            patients.sort((a, b) => {
                const k1 = this.getPatientBedSortKey(a, schemeIdx, a.row_idx || 0);
                const k2 = this.getPatientBedSortKey(b, schemeIdx, b.row_idx || 0);
                return this.compareBedSortKeys(k1, k2);
            });
        }

        patients.forEach((p, idx) => {
            const tr = document.createElement('tr');
            const origIdx = p.row_idx !== undefined ? p.row_idx : (idx + 1);

            const s1Cell = this.formatSchemeCell(p, 1);
            const s2Cell = this.formatSchemeCell(p, 2);
            const s3Cell = this.formatSchemeCell(p, 3);
            const s4Cell = this.formatSchemeCell(p, 4);

            tr.innerHTML = `
                <td style="font-weight: 600; text-align: center;">${origIdx}</td>
                ${s1Cell}
                ${s2Cell}
                ${s3Cell}
                ${s4Cell}
                <td class="editable-cell" title="雙擊可直接就地編輯姓名" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'name')" style="text-align: center;"><strong>${p.name || ''}</strong></td>
                <td class="editable-cell" title="雙擊可直接就地編輯性別" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'gender')" style="text-align: center;"><span style="color: ${p.gender === 'M' ? '#0284c7' : '#ec4899'}; font-weight: 700;">${p.gender === 'M' ? '男' : '女'}</span></td>
                <td class="editable-cell" title="雙擊可直接就地編輯醫師燈號" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'doc_code')" style="text-align: center;"><code>${p.doc_code || ''}</code></td>
                <td class="editable-cell" title="雙擊可直接就地編輯房型意願" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'bed_pref')"><span style="font-family: var(--font-mono); font-size: 11px;">${p.bed_pref || ''}</span></td>
                <td class="editable-cell" title="雙擊可直接就地編輯校正後意願" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'normalized_pref')"><code style="font-weight: 700; color: #1e40af;">${p.normalized_pref || BedAssignmentEngine.getNormalizedPreference(p.bed_pref || '')}</code></td>
                <td class="editable-cell" title="雙擊可直接就地編輯抵達通知" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'arrival')"><small>${p.arrival || ''}</small></td>
                <td style="text-align: center; white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; align-items: center; justify-content: center;">
                        <button class="btn btn-primary btn-sm" onclick="window.app.insertPatientBefore(${origIdx})" title="在此病人前方直接插入空白列 (可雙擊打字)">➕ 插入</button>
                        <button class="btn btn-danger btn-sm" onclick="window.app.deletePatient(${origIdx})" title="直接刪除此病人 (可按上一步復原)">🗑️ 刪除</button>
                    </div>
                </td>
            `;
            this.livePatientsTbody.appendChild(tr);
        });
    }

    renderFullPatientsTable() {
        if (!this.fullPatientsTbody) return;
        this.fullPatientsTbody.innerHTML = '';

        let patients = (this.manager.patientData && this.manager.patientData.patients) ? [...this.manager.patientData.patients] : [];

        // 依條件篩選
        const selCol = this.selectedSchemeCol || 1;
        if (this.filterStatus === 'assigned') {
            patients = patients.filter(p => (p[`is_assigned_${selCol}`] !== undefined ? p[`is_assigned_${selCol}`] : p.is_assigned));
        } else if (this.filterStatus === 'pending') {
            patients = patients.filter(p => !(p[`is_assigned_${selCol}`] !== undefined ? p[`is_assigned_${selCol}`] : p.is_assigned));
        } else if (this.filterStatus === 'delayed') {
            patients = patients.filter(p => String(p[`status_bed_${selCol}`] || p.status_bed || '').toLowerCase().includes('delay'));
        }

        if (this.filterGender === 'M') patients = patients.filter(p => p.gender === 'M');
        else if (this.filterGender === 'F') patients = patients.filter(p => p.gender === 'F');

        if (this.filterWard !== 'all') {
            patients = patients.filter(p => {
                const w = p[`assigned_ward_${selCol}`] || p.assigned_ward;
                return w && String(w).replace('A', '') === this.filterWard;
            });
        }

        if (this.filterSearch) {
            const q = this.filterSearch.toLowerCase();
            patients = patients.filter(p =>
                (p.name && p.name.toLowerCase().includes(q)) ||
                (p.chart_no && String(p.chart_no).includes(q)) ||
                (p.doc_code && String(p.doc_code).includes(q)) ||
                (p.diagnosis && p.diagnosis.toLowerCase().includes(q)) ||
                (p.bed_pref && p.bed_pref.toLowerCase().includes(q))
            );
        }

        if (patients.length === 0) {
            this.fullPatientsTbody.innerHTML = `<tr><td colspan="18" style="text-align:center; padding: 30px; color: var(--text-dim);">無符合篩選條件之病人</td></tr>`;
            return;
        }

        // 床位排序
        if (this.rtBedSortActive) {
            const schemeIdx = this.selectedSchemeCol || 1;
            patients.sort((a, b) => {
                const k1 = this.getPatientBedSortKey(a, schemeIdx, a.row_idx || 0);
                const k2 = this.getPatientBedSortKey(b, schemeIdx, b.row_idx || 0);
                return this.compareBedSortKeys(k1, k2);
            });
        }

        patients.forEach((p, idx) => {
            const tr = document.createElement('tr');
            const origIdx = p.row_idx !== undefined ? p.row_idx : (idx + 1);

            const s1Cell = this.formatSchemeCell(p, 1);
            const s2Cell = this.formatSchemeCell(p, 2);
            const s3Cell = this.formatSchemeCell(p, 3);
            const s4Cell = this.formatSchemeCell(p, 4);

            tr.innerHTML = `
                <td style="text-align: center; font-weight: 600;">${origIdx}</td>
                ${s1Cell}
                ${s2Cell}
                ${s3Cell}
                ${s4Cell}
                <td class="editable-cell" title="雙擊可直接就地編輯聯絡/抗凝" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'contact')"><small>${p.contact || ''}</small></td>
                <td class="editable-cell" title="雙擊可直接就地編輯抵達通知" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'arrival')" style="text-align: center;"><small>${p.arrival || ''}</small></td>
                <td class="editable-cell" title="雙擊可直接就地編輯情況處置備註" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'note')"><small>${[p.cond, p.protocol, p.note].filter(Boolean).join(' ') || ''}</small></td>
                <td class="editable-cell" title="雙擊可直接就地編輯病歷號" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'chart_no')" style="text-align: center;"><code>${p.chart_no || ''}</code></td>
                <td class="editable-cell" title="雙擊可直接就地編輯姓名" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'name')" style="text-align: center;"><strong>${p.name || ''}</strong></td>
                <td class="editable-cell" title="雙擊可直接就地編輯性別" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'gender')" style="text-align: center;"><span style="color: ${p.gender === 'M' ? '#0284c7' : '#ec4899'}; font-weight: 700;">${p.gender === 'M' ? '男' : '女'}</span></td>
                <td class="editable-cell" title="雙擊可直接就地編輯主治醫師" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'doctor')" style="text-align: center;"><strong>${p.doctor || ''}</strong></td>
                <td class="editable-cell" title="雙擊可直接就地編輯燈號" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'doc_code')" style="text-align: center;"><code>${p.doc_code || ''}</code></td>
                <td title="請假代理為系統依醫師差勤自動計算" ondblclick="window.app.showToast('請假代理為系統依醫師請假紀錄自動帶出，如需變更請於「醫師與請假」分頁編輯！', 'info')"><small>${p.leave_proxy || '-'}</small></td>
                <td class="editable-cell" title="雙擊可直接就地編輯診斷與處置" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'diagnosis')"><small>${p.diagnosis || ''}</small></td>
                <td class="editable-cell" title="雙擊可直接就地編輯房型意願" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'bed_pref')"><span style="font-family: var(--font-mono); font-size: 11px;">${p.bed_pref || ''}</span></td>
                <td class="editable-cell" title="雙擊可直接就地編輯校正後房型意願" ondblclick="window.app.makeCellEditable(this, ${origIdx}, 'normalized_pref')" style="text-align: center;"><code style="font-weight: 700; color: #1e40af;">${p.normalized_pref || BedAssignmentEngine.getNormalizedPreference(p.bed_pref || '')}</code></td>
                <td style="text-align: center; white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; align-items: center; justify-content: center;">
                        <button class="btn btn-primary btn-sm" onclick="window.app.insertPatientBefore(${origIdx})" title="在此病人前方直接插入空白列 (可雙擊打字)">➕ 插入</button>
                        <button class="btn btn-danger btn-sm" onclick="window.app.deletePatient(${origIdx})" title="直接刪除此病人 (可按上一步復原)">🗑️ 刪除</button>
                    </div>
                </td>
            `;
            this.fullPatientsTbody.appendChild(tr);
        });
    }

    renderOverviewTab() {
        if (!this.overviewBedsContainer) return;
        this.overviewBedsContainer.innerHTML = '';

        const availableBeds = this.getAvailableBeds();
        const wards = BedConfigManager.STANDARD_WARDS;

        wards.forEach(w => {
            const wBeds = availableBeds.filter(b => String(b.ward).replace('A', '') === w);
            const card = document.createElement('div');
            card.className = `ward-card ward-${w}`;
            card.style.padding = '14px';

            const header = document.createElement('div');
            header.className = 'ward-card-header';
            header.innerHTML = `
                <div class="ward-badge">${w}</div>
                <div>
                    <h3 style="font-size: 16px; font-weight: 700;">${w} 病房床位明細</h3>
                    <div style="font-size: 12px; color: var(--text-muted);">可用空床合計: ${wBeds.length} 床</div>
                </div>
            `;
            card.appendChild(header);

            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
            grid.style.gap = '8px';
            grid.style.marginTop = '12px';

            wBeds.forEach(b => {
                const bEl = document.createElement('div');
                bEl.style.background = 'var(--bg-card)';
                bEl.style.border = '1px solid var(--border-color)';
                bEl.style.borderRadius = 'var(--radius-sm)';
                bEl.style.padding = '8px 10px';
                bEl.style.fontSize = '12px';

                bEl.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <strong style="font-size: 14px; color: var(--primary);">${b.bed_num} 床</strong>
                        <span class="badge" style="background: var(--bg-subtle); border: 1px solid var(--border-color);">${b.category}</span>
                    </div>
                    <div>主治: <strong>${b.doctor_name}</strong> (${b.doctor_code || '無代碼'})</div>
                    <div>類別: <span style="color: ${b.is_co_pay ? 'var(--warning)' : 'var(--success)'}; font-weight: 600;">${b.bed_type}</span></div>
                    <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">狀態: ${b.leave_status}</div>
                `;
                grid.appendChild(bEl);
            });

            card.appendChild(grid);
            this.overviewBedsContainer.appendChild(card);
        });
    }

    isLeaveActiveOnDate(periodStr, targetDate = null) {
        if (!periodStr) return false;
        const now = targetDate ? new Date(targetDate) : new Date();
        const currYear = now.getFullYear();
        const currMonth = now.getMonth() + 1;
        const currDay = now.getDate();
        const targetVal = new Date(currYear, currMonth - 1, currDay).getTime();

        const regex = /(?:(\d{2,4})[/\.-])?(\d{1,2})[/\.-](\d{1,2})/g;
        const matches = [];
        let match;
        while ((match = regex.exec(String(periodStr))) !== null) {
            matches.push(match);
        }
        if (matches.length === 0) return false;

        const parsedDates = [];
        for (const m of matches) {
            let y = m[1] ? parseInt(m[1], 10) : currYear;
            if (m[1] && y < 200) y += 1911; // 支援民國年
            const month = parseInt(m[2], 10);
            const day = parseInt(m[3], 10);
            parsedDates.push(new Date(y, month - 1, day));
        }

        let startDate = parsedDates[0];
        let endDate = parsedDates.length > 1 ? parsedDates[1] : parsedDates[0];

        // 處理跨年區間 (例如 12/28 - 1/5)
        if (!matches[0][1] && matches.length > 1 && !matches[1][1] && endDate < startDate) {
            if (currMonth === 1 && startDate.getMonth() === 11) {
                startDate = new Date(currYear - 1, startDate.getMonth(), startDate.getDate());
            } else if (currMonth === 12 && endDate.getMonth() === 0) {
                endDate = new Date(currYear + 1, endDate.getMonth(), endDate.getDate());
            }
        }

        return targetVal >= startDate.getTime() && targetVal <= endDate.getTime();
    }

    renderDoctorsTab() {
        const tbody = document.getElementById('unified-doctors-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const wards = (this.manager.data && this.manager.data.wards) ? this.manager.data.wards : {};
        const youngVList = this.manager.getYoungVList();

        const allDocs = [];
        for (const [wName, wInfo] of Object.entries(wards)) {
            const wClean = String(wName).replace('A', '');
            (wInfo.doctors || []).forEach(d => {
                allDocs.push({
                    ward: wClean,
                    ...d
                });
            });
        }

        // 依病房篩選與關鍵字篩選
        let filtered = allDocs;
        if (this.docWardFilter && this.docWardFilter !== 'all') {
            filtered = filtered.filter(d => d.ward === this.docWardFilter);
        }
        if (this.docFilterSearch) {
            const q = this.docFilterSearch.toLowerCase();
            filtered = filtered.filter(d =>
                (d.name && d.name.toLowerCase().includes(q)) ||
                (d.code && String(d.code).toLowerCase().includes(q)) ||
                (d.ward && String(d.ward).toLowerCase().includes(q)) ||
                (d.bed_str && d.bed_str.toLowerCase().includes(q))
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--text-dim);">無符合條件之醫師資料</td></tr>`;
        } else {
            filtered.forEach(d => {
                const tr = document.createElement('tr');
                const isYoungV = youngVList.includes(String(d.code));
                if (isYoungV) tr.classList.add('is-young-v');
                tr.setAttribute('data-ward', d.ward || '');
                tr.setAttribute('data-code', d.code || '');
                tr.setAttribute('data-name', d.name || '');

                let leaveCellClass = '';
                let leaveBadge = `<span class="badge badge-assigned">在勤</span>`;

                if (d.leave_info && (d.leave_info.period || d.leave_info.proxy)) {
                    const isToday = this.isLeaveActiveOnDate(d.leave_info.period);
                    if (isToday) {
                        leaveCellClass = 'cell-leave-today';
                        leaveBadge = `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #991b1b; border: 1px solid #fca5a5; font-weight: 700;">🔴 今日請假 (${d.leave_info.period} 由 ${d.leave_info.proxy} 代理)</span>`;
                    } else {
                        leaveCellClass = 'cell-leave-scheduled';
                        leaveBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #92400e; border: 1px solid #fde68a; font-weight: 600;">🟡 請假 (${d.leave_info.period} 由 ${d.leave_info.proxy} 代理)</span>`;
                    }
                }

                const safeName = (d.name || '').replace(/'/g, "\\'");
                const safeCode = (d.code || '').replace(/'/g, "\\'");
                const safeWard = (d.ward || '').replace(/'/g, "\\'");

                tr.innerHTML = `
                    <td class="editable-cell" style="text-align: center;" title="雙擊可直接就地編輯病房代碼" ondblclick="window.app.makeDoctorCellEditable(this, 'ward')">
                        <span class="ward-badge-pill ward-${d.ward}">${d.ward}</span>
                    </td>
                    <td class="editable-cell" style="text-align: center;" title="雙擊可直接就地編輯主治醫師姓名" ondblclick="window.app.makeDoctorCellEditable(this, 'name')">
                        <strong>${d.name || ''}</strong>${isYoungV ? ' <span class="badge" style="background:#dbeafe; color:#1e40af; font-size:10px;">新進</span>' : ''}
                    </td>
                    <td class="editable-cell" style="text-align: center;" title="雙擊可直接就地編輯醫師燈號" ondblclick="window.app.makeDoctorCellEditable(this, 'code')">
                        <code>${d.code || ''}</code>
                    </td>
                    <td class="editable-cell" style="font-family: var(--font-mono); font-size: 11px;" title="雙擊可直接就地編輯專屬配床區間 (例如: 1-10 或 11-14)" ondblclick="window.app.makeDoctorCellEditable(this, 'bed_str')">
                        ${d.bed_str || '無專屬床位'}
                    </td>
                    <td class="editable-cell ${leaveCellClass}" title="雙擊可直接就地編輯請假代理 (例如: 10/1-10/5 由 張醫師 代理，清空則為在勤)" ondblclick="window.app.makeDoctorCellEditable(this, 'leave')">
                        ${leaveBadge}
                    </td>
                    <td style="text-align: center;">
                        <button class="btn btn-secondary btn-sm" onclick="window.app.openDoctorEditModal('${safeWard}', '${safeName}', '${safeCode}')">✏️ 編輯</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        // 請假列表
        if (this.leavesListContainer) {
            this.leavesListContainer.innerHTML = '';
            const leaves = (this.manager.data && this.manager.data.leaves) ? this.manager.data.leaves : [];
            let leavesRows = leaves.map((l, idx) => `
                <tr>
                    <td style="text-align: center;">${idx + 1}</td>
                    <td style="text-align: center;"><strong>${l.doctor}</strong></td>
                    <td style="text-align: center;"><code>${l.period}</code></td>
                    <td style="text-align: center;"><strong>${l.proxy}</strong> 醫師</td>
                    <td><small>${l.raw || ''}</small></td>
                </tr>
            `).join('');

            this.leavesListContainer.innerHTML = `
                <div class="table-responsive" style="max-height: 250px;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th style="width: 40px; text-align: center;">#</th>
                                <th style="width: 100px; text-align: center;">請假醫師</th>
                                <th style="width: 130px; text-align: center;">請假期間</th>
                                <th style="width: 110px; text-align: center;">代理醫師</th>
                                <th>公文註記</th>
                            </tr>
                        </thead>
                        <tbody>${leavesRows || '<tr><td colspan="5" style="text-align:center; color: var(--text-dim); padding: 16px;">目前無請假紀錄</td></tr>'}</tbody>
                    </table>
                </div>
            `;
        }
    }

    renderRulesTab() {
        if (!this.rulesContentContainer) return;
        const ext = (this.manager.data && this.manager.data.extensions) || [];
        const pri = (this.manager.data && this.manager.data.pricing) || [];
        const rul = (this.manager.data && this.manager.data.rules) || [];

        this.rulesContentContainer.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px;">
                    <h4 style="font-size: 15px; font-weight: 700; color: #1e3a8a; margin-bottom: 8px;">📞 分機號碼與重要備註</h4>
                    <ul style="padding-left: 20px; line-height: 1.8;">
                        ${ext.map(x => `<li>${x}</li>`).join('') || '<li>暫無分機註記</li>'}
                    </ul>
                </div>
                <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px;">
                    <h4 style="font-size: 15px; font-weight: 700; color: #1e3a8a; margin-bottom: 8px;">💰 病房收費與差額標準</h4>
                    <ul style="padding-left: 20px; line-height: 1.8;">
                        ${pri.map(x => `<li>${x}</li>`).join('') || '<li>122病房雙人差額: 2400元/天；單人: 5000元/天</li><li>119病房: 12000元/天；192病房: 8600元/天；129病房: 20000元/天</li>'}
                    </ul>
                </div>
                <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px;">
                    <h4 style="font-size: 15px; font-weight: 700; color: #1e3a8a; margin-bottom: 8px;">⚖️ 核心排床與簽床規範</h4>
                    <ul style="padding-left: 20px; line-height: 1.8;">
                        <li>同位階排序：原本就有 <b>delay 1 (或以上)</b> 的病人優先排床；排完 delay 的才考慮同位階校正後意願最少者 (MRV)</li>
                        <li>校正後意願最少者優先：只有 1 &gt; 只有 2$ &gt; 只有 2 與只有 4，同等級隨機決定打破輸入順序偏誤</li>
                        <li>意願包含「<b>124優先</b>」者，優先分配 124 病房之本床或借床</li>
                        <li>房型意願智慧校正：<code>必2人房 / 2人床 (NHI &gt; $) / 2人(差額可) &rarr; 2&gt;2$</code>、<code>單人&gt;榮民 &rarr; 1&gt;2$&gt;2</code>、<code>1 &gt; 2 &rarr; 1&gt;2&gt;2$</code>、<code>健保2&gt;單 &rarr; 2&gt;2$&gt;1</code></li>
                        <li>1782 與 1772 嚴格禁止互借床位</li>
                        <li>1772 禁止借用 124 病房任何床位</li>
                        <li>1782 禁止借用 121 病房任何床位</li>
                        <li>雙空房每兩床為一間，一人入住後同房夥伴自動鎖定為同性別</li>
                    </ul>
                </div>
            </div>
        `;
    }

    /* ==========================================================================
       檔案讀取與匯入流程 (Word, Excel, Clipboard)
       ========================================================================== */
    async handleDocxUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const arrayBuffer = await file.arrayBuffer();
            const result = await DocxParser.parseDocx(arrayBuffer, file.name);

            this.manager.setData(result);
            this.updateHeaderStatus();
            this.updateAllWardHighlights();
            this.renderDoctorsTab();
            this.renderRulesTab();
            this.manager.saveSharedConfig();

            this.showToast("✅ Word 醫師床位表已更新並儲存於本機！若需分享至其他電腦，可點擊「💾 匯出設定檔」。", "success");
        } catch (err) {
            console.error(err);
            this.showToast(`解析 Word 檔失敗: ${err.message}`, "error");
        } finally {
            event.target.value = '';
        }
    }

    async handleExcelUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const arrayBuffer = await file.arrayBuffer();
            const result = ExcelPatientParser.parseExcel(arrayBuffer, file.name);

            this.manager.setPatientData(result);
            this.originalPatientData = JSON.parse(JSON.stringify(result));
            this.hasAutoAssigned = false;

            this.updateHeaderStatus();
            this.updateAllWardHighlights();
            this.renderAllTables();
            this.updateGlobalStatusBar();
            this.manager.savePrivatePatients(this.originalPatientData);
            this.showToast(`已載入 Excel 病人名單 (${result.patients.length} 位)，僅保存在此電腦（不外洩、不共用）`, "success");
        } catch (err) {
            console.error(err);
            this.showToast(`讀取 Excel 失敗: ${err.message}`, "error");
        } finally {
            event.target.value = '';
        }
    }

    importPatientFromText(text, sourceDesc = "剪貼簿") {
        if (!text || !text.trim()) {
            throw new Error("貼上內容為空，請先在 Excel 框選表格並按 Ctrl+C 複製！");
        }
        const result = ExcelPatientParser.parseClipboardTSV(text);
        if (!result || !result.patients || result.patients.length === 0) {
            throw new Error("未解析到有效病人資料，請確認複製範圍包含病患姓名或病歷號！");
        }
        this.pushUndoSnapshot();
        this.manager.setPatientData(result);
        this.originalPatientData = JSON.parse(JSON.stringify(result));
        this.hasAutoAssigned = false;

        this.updateHeaderStatus();
        this.updateAllWardHighlights();
        this.renderAllTables();
        this.updateGlobalStatusBar();
        this.manager.savePrivatePatients(this.originalPatientData);
        this.showToast(`✅ 已從${sourceDesc}匯入 ${result.patients.length} 位病人，僅保存在此電腦（免授權、不外洩）`, "success");
        return result;
    }

    async handleClipboardImport() {
        let text = null;

        // 先嘗試讀取系統剪貼簿 (若已授權或處於安全內容，可直接秒速讀取)
        if (navigator.clipboard && navigator.clipboard.readText) {
            try {
                text = await navigator.clipboard.readText();
            } catch (err) {
                console.warn("navigator.clipboard.readText 需使用者授權或受限:", err);
            }
        }

        // 若成功從剪貼簿讀取到內容，直接解析匯入
        if (text && text.trim()) {
            try {
                this.importPatientFromText(text, "剪貼簿 (Ctrl+C)");
                return;
            } catch (err) {
                // 剪貼簿有內容但格式不符合時，直接顯示錯誤提示，不彈出無謂視窗
                this.showToast(err.message, "error");
                return;
            }
        }

        // 若剪貼簿讀取成功但內容為空
        if (text !== null && !text.trim()) {
            this.showToast("剪貼簿內容為空，請先在 Excel 或 Google Sheets 框選表格並按 Ctrl+C 複製！", "warning");
            return;
        }

        // 若受限於本機檔案 (file:///) 瀏覽器安全限制無法直接讀取剪貼簿，才開啟極速貼上彈窗
        this.openQuickPasteModal();
    }

    openQuickPasteModal() {
        this.openModal('quick-paste-modal');
        setTimeout(() => {
            const inp = document.getElementById('quick-paste-input');
            if (inp) {
                inp.value = '';
                inp.focus();
            }
        }, 120);
    }

    submitQuickPaste() {
        const inp = document.getElementById('quick-paste-input');
        if (!inp || !inp.value.trim()) {
            this.showToast("請先按 Ctrl+V 貼上病人表格資料！", "warning");
            return;
        }
        try {
            this.importPatientFromText(inp.value.trim(), "快速貼上");
            inp.value = '';
            this.closeModal('quick-paste-modal');
        } catch (err) {
            this.showToast(err.message, "error");
        }
    }

    /* ==========================================================================
       自動排床與方案切換核心
       ========================================================================== */
    executeAutoAssign() {
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        if (patients.length === 0) {
            this.showToast("請先導入本日入院病人名單！", "warning");
            return;
        }

        // 儲存當前狀態至上一步歷史快照
        this.pushUndoSnapshot();

        const availableBeds = this.getAvailableBeds();
        if (availableBeds.length === 0) {
            this.showToast("目前各病房尚未填入任何可用空床號！", "warning");
            return;
        }

        // 僅對非手動指定且非原始輸入預排的病人清空前次演算法排定的床位標記，嚴格保留使用者編輯與原始輸入之預排床位
        patients.forEach(p => {
            const rawSt = String(p.raw_status_bed || '').trim();
            const hasRaw = Boolean(rawSt && !rawSt.toLowerCase().includes('delay') && !rawSt.includes('待') && !['-', '無'].includes(rawSt));
            const isPreassigned = Boolean(p.is_manual_assigned || hasRaw);

            if (!isPreassigned) {
                p.is_assigned = false;
                p.status_bed = '';
                p.assigned_ward = '';
                p.assigned_bed = '';
                for (let k = 1; k <= 4; k++) {
                    p[`is_assigned_${k}`] = false;
                    p[`status_bed_${k}`] = '';
                    p[`assigned_ward_${k}`] = '';
                    p[`assigned_bed_${k}`] = '';
                }
            } else {
                // 預先指定或手動指定的床位維持在所有方案中
                const manualSt = p.status_bed;
                for (let k = 1; k <= 4; k++) {
                    p[`status_bed_${k}`] = manualSt;
                    p[`is_assigned_${k}`] = p.is_assigned;
                    p[`assigned_ward_${k}`] = p.assigned_ward;
                    p[`assigned_bed_${k}`] = p.assigned_bed;
                }
            }
        });

        this.showToast("⚡ 正在以最新設定試算 4 大排床方案 (Kuhn-Munkres 匈牙利二分圖求解)...", "info");

        setTimeout(() => {
            try {
                // 使用當前最新編輯後的 patients 與 beds 進行求解
                this.currentStrategies = BedAssignmentEngine.generateFourStrategies(patients, availableBeds, this.manager);

                const strat1 = this.currentStrategies.original || {};
                const strat2 = this.currentStrategies.gender_shortage_twin || {};
                const strat3 = this.currentStrategies.global_bipartite || {};
                const strat4 = this.currentStrategies.bipartite_after_step2 || {};

                const pts1 = strat1.patients || [];
                const pts2 = strat2.patients || [];
                const pts3 = strat3.patients || [];
                const pts4 = strat4.patients || [];

                patients.forEach((p, idx) => {
                    const rawSt = String(p.raw_status_bed || '').trim();
                    const hasRaw = Boolean(rawSt && !rawSt.toLowerCase().includes('delay') && !rawSt.includes('待') && !['-', '無'].includes(rawSt));
                    const isPreassigned = Boolean(p.is_manual_assigned || hasRaw);
                    if (isPreassigned) {
                        // 手動設定的床位作為最終結果不要進行重新排班，四個方案全數同步手動指定結果
                        const manualSt = p.status_bed;
                        for (let k = 1; k <= 4; k++) {
                            p[`status_bed_${k}`] = manualSt;
                            p[`is_assigned_${k}`] = p.is_assigned;
                            p[`assigned_ward_${k}`] = p.assigned_ward;
                            p[`assigned_bed_${k}`] = p.assigned_bed;
                        }
                        return;
                    }

                    const p1 = pts1[idx] || {};
                    const p2 = pts2[idx] || {};
                    const p3 = pts3[idx] || {};
                    const p4 = pts4[idx] || {};

                    p.status_bed_1 = p1.status_bed || "待排";
                    p.status_bed_2 = p2.status_bed || "待排";
                    p.status_bed_3 = p3.status_bed || "待排";
                    p.status_bed_4 = p4.status_bed || "待排";

                    p.assigned_ward_1 = p1.assigned_ward || '';
                    p.assigned_bed_1 = p1.assigned_bed || '';
                    p.is_assigned_1 = Boolean(p1.is_assigned);

                    p.assigned_ward_2 = p2.assigned_ward || '';
                    p.assigned_bed_2 = p2.assigned_bed || '';
                    p.is_assigned_2 = Boolean(p2.is_assigned);

                    p.assigned_ward_3 = p3.assigned_ward || '';
                    p.assigned_bed_3 = p3.assigned_bed || '';
                    p.is_assigned_3 = Boolean(p3.is_assigned);

                    p.assigned_ward_4 = p4.assigned_ward || '';
                    p.assigned_bed_4 = p4.assigned_bed || '';
                    p.is_assigned_4 = Boolean(p4.is_assigned);

                    // 套用當前選定欄位之方案
                    const selCol = this.selectedSchemeCol || 1;
                    p.status_bed = p[`status_bed_${selCol}`] || '';
                    p.assigned_ward = p[`assigned_ward_${selCol}`] || '';
                    p.assigned_bed = p[`assigned_bed_${selCol}`] || '';
                    p.is_assigned = Boolean(p[`is_assigned_${selCol}`]);
                });

                this.hasAutoAssigned = true;

                // 刷新介面
                this.updateAllWardHighlights();
                this.renderAllTables();
                this.updateGlobalStatusBar();
                this.manager.saveToLocalStorage();

                const chosenRep = (this.selectedSchemeCol === 2 ? strat2.report : (this.selectedSchemeCol === 3 ? strat3.report : (this.selectedSchemeCol === 4 ? strat4.report : strat1.report))) || {};
                this.showToast(`自動排床完成！四大方案已同步運算。\n排定 ${chosenRep.assigned_count || 0} 床，待排 ${chosenRep.unassigned_count || 0} 床 (本床率: ${(chosenRep.assigned_count > 0 ? (chosenRep.own_doc_count / chosenRep.assigned_count * 100).toFixed(1) : 0)}%)`, "success");
            } catch (err) {
                console.error(err);
                this.showToast(`自動排床運算發生錯誤: ${err.message}`, "error");
            }
        }, 50);
    }

    applyStrategyResult(strategyKey) {
        if (!this.currentStrategies || !this.currentStrategies[strategyKey]) return;

        this.activeStrategyKey = strategyKey;

        // 依據 strategyKey 決定 selectedSchemeCol
        if (strategyKey === 'original') this.selectedSchemeCol = 1;
        else if (strategyKey === 'gender_shortage_twin') this.selectedSchemeCol = 2;
        else if (strategyKey === 'global_bipartite') this.selectedSchemeCol = 3;
        else if (strategyKey === 'bipartite_after_step2') this.selectedSchemeCol = 4;

        this.selectBedSchemeColumn(this.selectedSchemeCol);
    }

    openStrategyModal() {
        if (!this.currentStrategies) {
            const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
            const availableBeds = this.getAvailableBeds();
            if (patients.length === 0 || availableBeds.length === 0) {
                this.showToast("請確認已填入床位與病人資料後再切換方案！", "warning");
                return;
            }
            this.currentStrategies = BedAssignmentEngine.generateFourStrategies(patients, availableBeds, this.manager);
        }

        const grid = document.getElementById('strategies-modal-grid');
        if (!grid) return;
        grid.innerHTML = '';

        for (const [key, item] of Object.entries(this.currentStrategies)) {
            const rep = item.report;
            const ratio = rep.assigned_count > 0 ? (rep.own_doc_count / rep.assigned_count * 100).toFixed(1) : "0.0";
            const isSelected = key === this.activeStrategyKey;

            const card = document.createElement('div');
            card.className = `strategy-card ${isSelected ? 'selected' : ''}`;
            card.onclick = () => {
                document.querySelectorAll('.strategy-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.selectedSchemeKey = key;
            };

            card.innerHTML = `
                <div class="strategy-header">
                    <div class="strategy-title">${item.name}</div>
                    <span class="strategy-badge">${item.badge}</span>
                </div>
                <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">${item.description}</div>
                <div class="strategy-metrics">
                    <div class="metric-item"><span>排定簽床:</span><strong class="metric-value" style="color: var(--success);">${rep.assigned_count} 床</strong></div>
                    <div class="metric-item"><span>本床佔比:</span><strong class="metric-value">${ratio}%</strong></div>
                    <div class="metric-item"><span>跨科借床:</span><strong class="metric-value">${rep.borrowed_count} 床</strong></div>
                    <div class="metric-item"><span>延後住院:</span><strong class="metric-value" style="color: ${rep.unassigned_count > 0 ? 'var(--danger)' : 'var(--success)'};">${rep.unassigned_count} 位</strong></div>
                </div>
            `;
            grid.appendChild(card);
        }

        this.selectedSchemeKey = this.activeStrategyKey;
        this.strategyModal.classList.add('show');
    }

    confirmApplyStrategy() {
        this.applyStrategyResult(this.selectedSchemeKey);
        this.closeModal('strategy-modal');
        const strat = this.currentStrategies[this.selectedSchemeKey];
        this.showToast(`已成功套用【${strat.name}】！`, "success");
    }

    pushUndoSnapshot() {
        if (!this.undoStack) this.undoStack = [];
        if (!this.redoStack) this.redoStack = [];
        // 使用者新操作發生時，清空重做堆疊
        this.redoStack = [];

        const snapshot = {
            patientData: JSON.parse(JSON.stringify((this.manager && this.manager.patientData) ? this.manager.patientData : {})),
            doctorConfig: JSON.parse(JSON.stringify((this.manager && this.manager.data) ? this.manager.data : {})),
            wardInputs: JSON.parse(JSON.stringify((this.manager && this.manager.inputs) ? this.manager.inputs : {})),
            hasAutoAssigned: Boolean(this.hasAutoAssigned),
            selectedSchemeCol: this.selectedSchemeCol || 1,
            currentStrategies: this.currentStrategies ? JSON.parse(JSON.stringify(this.currentStrategies)) : null
        };
        this.undoStack.push(snapshot);
        if (this.undoStack.length > 50) this.undoStack.shift();
    }

    undoLastAction() {
        if (!this.undoStack || this.undoStack.length === 0) {
            this.showToast("目前已無更多上一步操作可復原", "info");
            return;
        }
        if (!this.redoStack) this.redoStack = [];

        // 擷取當前狀態壓入 redoStack
        const currentSnapshot = {
            patientData: JSON.parse(JSON.stringify((this.manager && this.manager.patientData) ? this.manager.patientData : {})),
            doctorConfig: JSON.parse(JSON.stringify((this.manager && this.manager.data) ? this.manager.data : {})),
            wardInputs: JSON.parse(JSON.stringify((this.manager && this.manager.inputs) ? this.manager.inputs : {})),
            hasAutoAssigned: Boolean(this.hasAutoAssigned),
            selectedSchemeCol: this.selectedSchemeCol || 1,
            currentStrategies: this.currentStrategies ? JSON.parse(JSON.stringify(this.currentStrategies)) : null
        };
        this.redoStack.push(currentSnapshot);
        if (this.redoStack.length > 50) this.redoStack.shift();

        const snapshot = this.undoStack.pop();
        this._applyStateSnapshot(snapshot);
        this.showToast("↩ 已成功復原至上一筆修改前狀態！", "success");
    }

    redoNextAction() {
        if (!this.redoStack || this.redoStack.length === 0) {
            this.showToast("目前已無更多下一步操作可重做", "info");
            return;
        }
        if (!this.undoStack) this.undoStack = [];

        // 擷取當前狀態壓入 undoStack
        const currentSnapshot = {
            patientData: JSON.parse(JSON.stringify((this.manager && this.manager.patientData) ? this.manager.patientData : {})),
            doctorConfig: JSON.parse(JSON.stringify((this.manager && this.manager.data) ? this.manager.data : {})),
            wardInputs: JSON.parse(JSON.stringify((this.manager && this.manager.inputs) ? this.manager.inputs : {})),
            hasAutoAssigned: Boolean(this.hasAutoAssigned),
            selectedSchemeCol: this.selectedSchemeCol || 1,
            currentStrategies: this.currentStrategies ? JSON.parse(JSON.stringify(this.currentStrategies)) : null
        };
        this.undoStack.push(currentSnapshot);
        if (this.undoStack.length > 50) this.undoStack.shift();

        const snapshot = this.redoStack.pop();
        this._applyStateSnapshot(snapshot);
        this.showToast("↪ 已成功重做至下一步狀態！", "success");
    }

    _applyStateSnapshot(snapshot) {
        if (!snapshot) return;
        if (snapshot.patientData) {
            this.manager.setPatientData(snapshot.patientData);
        }
        if (snapshot.doctorConfig && Object.keys(snapshot.doctorConfig).length > 0) {
            this.manager.setData(snapshot.doctorConfig);
            this.renderDoctorsTab();
            this.renderRulesTab();
        }
        if (snapshot.wardInputs) {
            this.manager.inputs = snapshot.wardInputs;
            BedConfigManager.STANDARD_WARDS.forEach(w => {
                BedConfigManager.CATEGORIES.forEach(cat => {
                    const el = document.getElementById(`input-${w}-${cat}`);
                    if (el) el.value = this.manager.getInput(w, cat);
                });
            });
        }
        this.hasAutoAssigned = Boolean(snapshot.hasAutoAssigned);
        if (snapshot.selectedSchemeCol) {
            this.selectedSchemeCol = snapshot.selectedSchemeCol;
        }
        if (snapshot.currentStrategies) {
            this.currentStrategies = snapshot.currentStrategies;
        }

        this.updateAllWardHighlights();
        this.renderAllTables();
        this.updateGlobalStatusBar();
        this.manager.saveToLocalStorage();
    }

    resetToOriginal() {
        if (!this.originalPatientData || !this.originalPatientData.patients || this.originalPatientData.patients.length === 0) {
            this.showToast("尚未載入原始 Excel 名單", "warning");
            return;
        }
        if (!confirm("確定要恢復至最初載入之原始病人名單與設定嗎？\n（此操作將重設為剛匯入狀態，亦可按「↩ 上一步」撤銷）")) return;
        this.pushUndoSnapshot();
        this.manager.setPatientData(JSON.parse(JSON.stringify(this.originalPatientData)));
        this.hasAutoAssigned = false;
        this.currentStrategies = null;
        this.updateAllWardHighlights();
        this.renderAllTables();
        this.updateGlobalStatusBar();
        this.manager.saveToLocalStorage();
        this.showToast("已成功恢復至最初載入之原始病人名單與設定！", "success");
    }

    resetConfig() {
        this.resetToOriginal();
    }

    clearLocalPatientData() {
        if (!confirm("確定要安全清除本機瀏覽器中的病人名單快取嗎？\n（這只會清空此電腦上的暫存病人名單，不會影響共用的 Word 醫師配床設定，換班或離開公用電腦時建議執行）")) return;
        this.pushUndoSnapshot();
        if (this.manager) {
            this.manager.clearPrivatePatients();
        }
        this.originalPatientData = null;
        this.hasAutoAssigned = false;
        this.currentStrategies = null;
        this.updateHeaderStatus();
        this.updateAllWardHighlights();
        this.renderAllTables();
        this.updateGlobalStatusBar();
        this.showToast("🔒 已安全清空此電腦上的專屬病人名單與快取資料！", "success");
    }

    fillTestBeds() {
        this.pushUndoSnapshot();

        const hasAnyBed = (beds) => {
            if (!beds || typeof beds !== 'object') return false;
            return Object.values(beds).some(cats => 
                cats && typeof cats === 'object' && Object.values(cats).some(v => String(v).trim())
            );
        };

        let testBeds = BedConfigManager.DEFAULT_TEST_WARD_BEDS;
        if (this.manager?.testWardInputs && hasAnyBed(this.manager.testWardInputs)) {
            testBeds = JSON.parse(JSON.stringify(this.manager.testWardInputs));
        } else if (this.manager?.data?.test_ward_inputs && hasAnyBed(this.manager.data.test_ward_inputs)) {
            testBeds = JSON.parse(JSON.stringify(this.manager.data.test_ward_inputs));
        } else if (this.manager?.data?.ward_category_inputs && hasAnyBed(this.manager.data.ward_category_inputs)) {
            testBeds = JSON.parse(JSON.stringify(this.manager.data.ward_category_inputs));
        }

        // 強制確保 113 男2 測試床位為 16 17 (清除 45 舊快取)
        if (testBeds["113"]) {
            let m2 = String(testBeds["113"]["男2"] || '').trim();
            if (m2.includes('45') || !m2) {
                testBeds["113"]["男2"] = "16 17";
            }
        }
        if (this.manager.testWardInputs && this.manager.testWardInputs["113"]) {
            this.manager.testWardInputs["113"]["男2"] = "16 17";
        }

        BedConfigManager.STANDARD_WARDS.forEach(w => {
            const wBeds = testBeds[w] || {};
            BedConfigManager.CATEGORIES.forEach(cat => {
                let val = wBeds[cat] || '';
                if (w === '113' && cat === '男2' && (val.includes('45') || !val)) {
                    val = '16 17';
                }
                this.manager.updateInput(w, cat, val);
                const el = document.getElementById(`input-${w}-${cat}`);
                if (el) el.value = val;
            });
        });

        this.updateAllWardHighlights();
        this.renderAllTables();
        this.updateGlobalStatusBar();
        this.manager.saveToLocalStorage();
        this.showToast("🧪 已成功填入測試用床位資訊 (113-16, 113-17)！隨時可按「↩ 上一步」恢復原狀。", "success");
    }

    clearAllBeds() {
        if (!confirm("確定要清空 113~124 所有病房之床位資料嗎？")) return;
        this.pushUndoSnapshot();
        this.manager.clearAllInputs();
        BedConfigManager.STANDARD_WARDS.forEach(w => {
            BedConfigManager.CATEGORIES.forEach(cat => {
                const el = document.getElementById(`input-${w}-${cat}`);
                if (el) el.value = '';
            });
        });
        this.updateAllWardHighlights();
        this.updateGlobalStatusBar();
        this.manager.saveToLocalStorage();
        this.showToast("已清空全院病房所有床位輸入！", "info");
    }

    /* ==========================================================================
       AI Prompt 產生與複製
       ========================================================================== */
    openPromptModal() {
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        const availableBeds = this.getAvailableBeds();
        const promptText = AIPromptGenerator.generatePrompt(this.manager, availableBeds, patients);

        const textarea = document.getElementById('prompt-textarea');
        if (textarea) textarea.value = promptText;
        this.promptModal.classList.add('show');
    }

    async copyPromptToClipboard() {
        const textarea = document.getElementById('prompt-textarea');
        if (!textarea) return;
        try {
            await navigator.clipboard.writeText(textarea.value);
            this.showToast("已複製完整 AI Prompt 至剪貼簿！可直接貼給 ChatGPT / Gemini", "success");
        } catch (e) {
            textarea.select();
            document.execCommand('copy');
            this.showToast("已選取並複製 Prompt！", "success");
        }
    }

    /* ==========================================================================
       Excel 匯出與剪貼簿複製
       ========================================================================== */
    exportToExcel() {
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        if (patients.length === 0) {
            this.showToast("目前無病人資料可供匯出！", "warning");
            return;
        }

        if (typeof XLSX === 'undefined') {
            this.showToast("找不到 SheetJS 匯出庫！", "error");
            return;
        }

        const dataToExport = patients.map((p, idx) => ({
            "序號": idx + 1,
            "排床1 (基準)": p.status_bed_1 || p.status_bed || "",
            "排床2 (缺額優先)": p.status_bed_2 || "",
            "排床3 (全域二分圖)": p.status_bed_3 || "",
            "排床4 (步驟2二分圖)": p.status_bed_4 || "",
            "聯絡/抗凝": p.contact || "",
            "抵達通知": p.arrival || "",
            "情況處置備註": [p.cond, p.protocol, p.note].filter(Boolean).join(' '),
            "病歷號": p.chart_no || "",
            "姓名": p.name || "",
            "性別": p.gender === 'M' ? '男' : '女',
            "主治醫師": p.doctor || "",
            "醫師代碼": p.doc_code || "",
            "請假代理": p.leave_proxy || "",
            "診斷與處置": p.diagnosis || "",
            "原始房型意願": p.bed_pref || "",
            "校正後房型意願": p.normalized_pref || ""
        }));

        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "四大方案簽床分配結果");

        const now = new Date();
        const fname = `簽床排床結果_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.xlsx`;
        XLSX.writeFile(wb, fname);

        this.showToast(`成功匯出四大方案 Excel：${fname}`, "success");
    }

    async copyTableToClipboard() {
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        if (patients.length === 0) {
            this.showToast("無資料可複製！", "warning");
            return;
        }

        const headers = ["序號", "排床1", "排床2", "排床3", "排床4", "病歷號", "姓名", "性別", "醫師", "意願", "校正後意願", "抵達", "診斷"];
        const rows = [headers.join('\t')];
        patients.forEach((p, idx) => {
            rows.push([
                idx + 1,
                p.status_bed_1 || p.status_bed || "",
                p.status_bed_2 || "",
                p.status_bed_3 || "",
                p.status_bed_4 || "",
                p.chart_no || "",
                p.name || "",
                p.gender || "",
                p.doc_code || "",
                p.bed_pref || "",
                p.normalized_pref || "",
                p.arrival || "",
                p.diagnosis || ""
            ].join('\t'));
        });

        try {
            await navigator.clipboard.writeText(rows.join('\n'));
            this.showToast("已將全體病人名單複製至剪貼簿 (可直接在 Excel 按 Ctrl+V 貼上)", "success");
        } catch (e) {
            this.showToast("剪貼簿存取受限", "error");
        }
    }

    /* ==========================================================================
       病人編輯、插入與刪除模態框操作
       ========================================================================== */
    openPatientEditModal(rowIdx) {
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        const titleEl = document.getElementById('patient-modal-title');
        const saveBtn = document.getElementById('btn-save-patient-modal');
        const quickBlankBtn = document.getElementById('btn-patient-quick-blank');
        const insertBeforeEl = document.getElementById('edit-patient-insert-before');
        if (insertBeforeEl) insertBeforeEl.value = '';
        if (quickBlankBtn) quickBlankBtn.style.display = 'none';

        if (rowIdx === -1) {
            // 新增病人 (加入至名單末端)
            if (titleEl) titleEl.textContent = '➕ 新增入院病人 (加入至名單末端)';
            if (saveBtn) saveBtn.textContent = '➕ 確認新增';
            document.getElementById('edit-patient-row-idx').value = -1;
            document.getElementById('edit-patient-name').value = '';
            document.getElementById('edit-patient-chart-no').value = '';
            document.getElementById('edit-patient-gender').value = 'M';
            document.getElementById('edit-patient-doc-code').value = '';
            document.getElementById('edit-patient-status-bed').value = '';
            document.getElementById('edit-patient-bed-pref').value = '';
            document.getElementById('edit-patient-normalized-pref').value = '';
            document.getElementById('edit-patient-arrival').value = '';
            document.getElementById('edit-patient-diagnosis').value = '';
            document.getElementById('edit-patient-contact').value = '';
            this.patientEditModal.classList.add('show');
            return;
        }

        const p = patients.find(x => (x.row_idx === rowIdx || patients.indexOf(x) + 1 === rowIdx));
        if (!p) return;

        if (titleEl) titleEl.textContent = `✏️ 編輯第 ${rowIdx} 筆病人入院資訊`;
        if (saveBtn) saveBtn.textContent = '儲存修改';
        document.getElementById('edit-patient-row-idx').value = rowIdx;
        document.getElementById('edit-patient-name').value = p.name || '';
        document.getElementById('edit-patient-chart-no').value = p.chart_no || '';
        document.getElementById('edit-patient-gender').value = p.gender || 'M';
        document.getElementById('edit-patient-doc-code').value = p.doc_code || '';
        document.getElementById('edit-patient-status-bed').value = p.status_bed || '';
        document.getElementById('edit-patient-bed-pref').value = p.bed_pref || '';
        document.getElementById('edit-patient-normalized-pref').value = p.normalized_pref || '';
        document.getElementById('edit-patient-arrival').value = p.arrival || '';
        document.getElementById('edit-patient-diagnosis').value = p.diagnosis || '';
        document.getElementById('edit-patient-contact').value = p.contact || '';

        this.patientEditModal.classList.add('show');
    }

    /**
     * 開啟在指定病人前方插入病人的視窗
     */
    openPatientInsertModal(targetRowIdx) {
        const patients = (this.manager.patientData && this.manager.patientData.patients) ? this.manager.patientData.patients : [];
        const targetP = patients.find(x => (x.row_idx === targetRowIdx || patients.indexOf(x) + 1 === targetRowIdx));
        const targetName = targetP && targetP.name ? `【${targetP.name}】` : '';

        const titleEl = document.getElementById('patient-modal-title');
        if (titleEl) titleEl.textContent = `➕ 插入新病人 (插入於第 ${targetRowIdx} 筆 ${targetName} 前方)`;

        const saveBtn = document.getElementById('btn-save-patient-modal');
        if (saveBtn) saveBtn.textContent = '➕ 確認插入';

        const quickBlankBtn = document.getElementById('btn-patient-quick-blank');
        if (quickBlankBtn) quickBlankBtn.style.display = 'inline-flex';

        document.getElementById('edit-patient-row-idx').value = -1;
        const insertBeforeEl = document.getElementById('edit-patient-insert-before');
        if (insertBeforeEl) insertBeforeEl.value = targetRowIdx;

        document.getElementById('edit-patient-name').value = '';
        document.getElementById('edit-patient-chart-no').value = '';
        document.getElementById('edit-patient-gender').value = 'M';
        document.getElementById('edit-patient-doc-code').value = '';
        document.getElementById('edit-patient-status-bed').value = '';
        document.getElementById('edit-patient-bed-pref').value = '';
        document.getElementById('edit-patient-normalized-pref').value = '';
        document.getElementById('edit-patient-arrival').value = '';
        document.getElementById('edit-patient-diagnosis').value = '';
        document.getElementById('edit-patient-contact').value = '';

        this.patientEditModal.classList.add('show');
    }

    /**
     * 從彈窗直接插入空白病人列，方便就地雙擊打字
     */
    quickInsertBlankPatient() {
        const insertBeforeEl = document.getElementById('edit-patient-insert-before');
        const targetRowIdx = insertBeforeEl && insertBeforeEl.value ? parseInt(insertBeforeEl.value, 10) : null;
        this.closeModal('patient-edit-modal');
        this.insertPatientBefore(targetRowIdx, null);
    }

    /**
     * 刪除指定病人 (直接刪除，免跳提醒方框，支援上一步復原)
     */
    deletePatient(rowIdx) {
        if (!this.manager.patientData || !this.manager.patientData.patients) {
            this.showToast("目前尚無病人資料可刪除", "warning");
            return;
        }
        const patients = this.manager.patientData.patients;
        const pIndex = patients.findIndex(x => (x.row_idx === rowIdx || patients.indexOf(x) + 1 === rowIdx));
        if (pIndex === -1) {
            this.showToast("找不到欲刪除的病人資料", "warning");
            return;
        }
        const p = patients[pIndex];
        const pName = p.name ? `「${p.name}」` : `第 ${rowIdx} 筆病人`;

        this.pushUndoSnapshot();
        patients.splice(pIndex, 1);

        // 重新為剩餘病人重新編列序號 row_idx (1 ~ N)
        patients.forEach((item, idx) => {
            item.row_idx = idx + 1;
        });

        this.updateAllWardHighlights();
        this.renderAllTables();
        this.updateGlobalStatusBar();
        this.manager.saveToLocalStorage();
        this.showToast(`已刪除病人 ${pName}！(可隨時按「↩ 上一步」復原)`, "info");
    }

    /**
     * 插入病人在目標病人前方
     */
    insertPatientBefore(targetRowIdx, patientData = null) {
        if (!this.manager.patientData) {
            this.manager.patientData = { file_name: '', parsed_at: '', patients: [] };
        }
        if (!this.manager.patientData.patients) {
            this.manager.patientData.patients = [];
        }
        const patients = this.manager.patientData.patients;

        let targetIdx = -1;
        if (targetRowIdx !== null && targetRowIdx !== undefined) {
            targetIdx = patients.findIndex(x => (x.row_idx === targetRowIdx || patients.indexOf(x) + 1 === targetRowIdx));
        }
        if (targetIdx === -1) {
            targetIdx = patients.length;
        }

        this.pushUndoSnapshot();

        const p = patientData ? { ...patientData } : {
            name: '',
            chart_no: '',
            gender: 'M',
            doc_code: '',
            bed_pref: '',
            normalized_pref: '',
            arrival: '',
            diagnosis: '',
            contact: '',
            status_bed: ''
        };

        p.gender = p.gender || 'M';
        p.bed_pref = p.bed_pref || '';
        p.normalized_pref = p.normalized_pref || (typeof BedAssignmentEngine !== 'undefined' ? BedAssignmentEngine.getNormalizedPreference(p.bed_pref) : p.bed_pref);
        p.arrival = p.arrival || '';
        p.status_bed = p.status_bed || '';
        p.raw_status_bed = p.status_bed;
        p.initial_delay_days = (typeof ExcelPatientParser !== 'undefined')
            ? ExcelPatientParser.extractDelayDays(p.status_bed)
            : 0;

        if (p.doc_code) {
            const cleanDigits = String(p.doc_code).replace(/\D/g, '');
            const docObj = cleanDigits ? this.manager.lookupDoctorByCode(cleanDigits) : null;
            if (docObj) {
                p.doctor = docObj.name;
                p.doctor_name = docObj.name;
            }
        }

        const isAss = Boolean(p.status_bed && !p.status_bed.toLowerCase().includes('delay') && !['待排', '-', '無', '待'].includes(p.status_bed));
        p.is_assigned = isAss;
        p.is_manual_assigned = isAss;
        p.is_bed_locked = isAss;

        for (let k = 1; k <= 4; k++) {
            if (p[`status_bed_${k}`] === undefined) p[`status_bed_${k}`] = p.status_bed;
            if (p[`is_assigned_${k}`] === undefined) p[`is_assigned_${k}`] = isAss;
            if (p[`is_manual_assigned_${k}`] === undefined) p[`is_manual_assigned_${k}`] = isAss;
        }

        patients.splice(targetIdx, 0, p);

        // 重新為全體病人編列序號 row_idx (1 ~ N)
        patients.forEach((item, idx) => {
            item.row_idx = idx + 1;
        });

        this.updateAllWardHighlights();
        this.renderAllTables();
        this.updateGlobalStatusBar();
        this.manager.saveToLocalStorage();

        const pDesc = p.name ? `「${p.name}」` : `空白病人`;
        this.showToast(`已於第 ${targetIdx + 1} 列插入${pDesc}！雙擊欄位即可直接打字，或按「↩ 上一步」復原。`, "success");
    }

    savePatientEdit() {
        this.pushUndoSnapshot();
        const rowIdx = parseInt(document.getElementById('edit-patient-row-idx').value, 10);
        if (!this.manager.patientData) {
            this.manager.patientData = { file_name: '', parsed_at: '', patients: [] };
        }
        if (!this.manager.patientData.patients) {
            this.manager.patientData.patients = [];
        }
        const patients = this.manager.patientData.patients;

        let p = null;
        const isNew = (rowIdx === -1);
        const insertBeforeVal = document.getElementById('edit-patient-insert-before') ? document.getElementById('edit-patient-insert-before').value : '';
        const insertBeforeRowIdx = insertBeforeVal ? parseInt(insertBeforeVal, 10) : null;

        if (isNew) {
            p = {};
            let targetIdx = -1;
            if (insertBeforeRowIdx !== null && !isNaN(insertBeforeRowIdx)) {
                targetIdx = patients.findIndex(x => (x.row_idx === insertBeforeRowIdx || patients.indexOf(x) + 1 === insertBeforeRowIdx));
            }
            if (targetIdx !== -1) {
                patients.splice(targetIdx, 0, p);
            } else {
                patients.push(p);
            }
        } else {
            p = patients.find(x => (x.row_idx === rowIdx || patients.indexOf(x) + 1 === rowIdx));
            if (!p) return;
        }

        p.name = document.getElementById('edit-patient-name').value.trim();
        p.chart_no = document.getElementById('edit-patient-chart-no').value.trim();
        p.gender = document.getElementById('edit-patient-gender').value;
        p.doc_code = document.getElementById('edit-patient-doc-code').value.trim();
        p.bed_pref = document.getElementById('edit-patient-bed-pref').value.trim();

        const userNorm = document.getElementById('edit-patient-normalized-pref').value.trim();
        p.normalized_pref = userNorm || (typeof BedAssignmentEngine !== 'undefined' ? BedAssignmentEngine.getNormalizedPreference(p.bed_pref) : p.bed_pref);

        p.arrival = document.getElementById('edit-patient-arrival').value.trim();
        p.diagnosis = document.getElementById('edit-patient-diagnosis').value.trim();
        p.contact = document.getElementById('edit-patient-contact').value.trim();

        // 關聯主治醫師姓名
        const cleanDigits = String(p.doc_code).replace(/\D/g, '');
        const docObj = cleanDigits ? this.manager.lookupDoctorByCode(cleanDigits) : null;
        if (docObj) {
            p.doctor = docObj.name;
            p.doctor_name = docObj.name;
        }

        let newSt = document.getElementById('edit-patient-status-bed').value.trim();
        if (newSt) {
            const pre = typeof ExcelPatientParser !== 'undefined' ? ExcelPatientParser.parsePreassignedBed(newSt) : null;
            if (pre) {
                const wName = pre.ward || pre[0];
                const bNum = pre.bedNum || pre[1];
                const bInt = parseInt(bNum, 10);
                const bInfo = !isNaN(bInt) && this.manager ? this.manager.lookupBed(wName, bInt) : null;

                if (bInfo && !/\(.*?\)/.test(newSt)) {
                    const pClean = String(p.doc_code || '').replace(/\D/g, '');
                    const bDoc = bInfo.clean_doc_code || '';
                    const proxyName = bInfo.proxy_doctor || '';
                    const proxyDoc = proxyName ? this.manager.lookupDoctorByName(proxyName) : null;
                    const proxyC = proxyDoc ? (proxyDoc.code || '').replace(/\D/g, '') : '';

                    if (pClean !== bDoc) {
                        const effCode = proxyC || bDoc;
                        if (effCode) newSt = `${wName}-${bNum} (${effCode})`;
                    } else if (proxyC) {
                        newSt = `${wName}-${bNum} (${proxyC})`;
                    }
                }
            }

            p.status_bed = newSt;
            p.raw_status_bed = newSt;
            p.initial_delay_days = (typeof ExcelPatientParser !== 'undefined')
                ? ExcelPatientParser.extractDelayDays(newSt)
                : 0;
            for (let k = 1; k <= 4; k++) {
                p[`status_bed_${k}`] = newSt;
            }
            const isAss = Boolean(newSt && !newSt.toLowerCase().includes('delay') && !['待排', '-', '無', '待'].includes(newSt));
            p.is_assigned = isAss;
            p.is_manual_assigned = isAss;
            p.is_bed_locked = isAss;
            delete p.bed_lock_restore;
            for (let k = 1; k <= 4; k++) {
                p[`is_assigned_${k}`] = isAss;
                p[`is_manual_assigned_${k}`] = isAss;
            }
            if (pre) {
                const wName = pre.ward || pre[0];
                const bNum = pre.bedNum || pre[1];
                p.assigned_ward = wName;
                p.assigned_bed = bNum;
                for (let k = 1; k <= 4; k++) {
                    p[`assigned_ward_${k}`] = wName;
                    p[`assigned_bed_${k}`] = bNum;
                }
            }
        } else if (isNew) {
            p.status_bed = '';
            p.raw_status_bed = '';
            p.initial_delay_days = 0;
            p.is_assigned = false;
            p.is_manual_assigned = false;
            p.is_bed_locked = false;
            for (let k = 1; k <= 4; k++) {
                p[`status_bed_${k}`] = '';
                p[`is_assigned_${k}`] = false;
                p[`is_manual_assigned_${k}`] = false;
            }
        }

        // 重新重編全體 row_idx (1 ~ N)
        patients.forEach((item, idx) => {
            item.row_idx = idx + 1;
        });

        this.closeModal('patient-edit-modal');
        this.updateAllWardHighlights();
        this.renderAllTables();
        this.updateGlobalStatusBar();
        this.manager.saveToLocalStorage();
        const actionDesc = isNew ? (insertBeforeRowIdx ? '插入' : '新增') : '修改';
        this.showToast(`已${actionDesc}病人 ${p.name || ''} 的資料，再次點擊「自動排床」將依此最新資料重新排床！`, "success");
    }

    /* ==========================================================================
       醫師編輯模態框
       ========================================================================== */
    openDoctorEditModal(ward, name, code) {
        document.getElementById('edit-doc-orig-ward').value = ward || '113';
        document.getElementById('edit-doc-orig-code').value = code || '';
        document.getElementById('edit-doc-ward').value = ward || '113';
        document.getElementById('edit-doc-name').value = name || '';
        document.getElementById('edit-doc-code').value = code || '';

        let bedStr = '';
        let leavePeriod = '';
        if (this.manager.data && this.manager.data.wards) {
            const wInfo = this.manager.data.wards[ward] || this.manager.data.wards[`A${ward}`];
            if (wInfo && wInfo.doctors) {
                const doc = wInfo.doctors.find(d => d.code === code || d.name === name);
                if (doc) {
                    bedStr = doc.bed_str || '';
                    if (doc.leave_info) {
                        leavePeriod = `${doc.leave_info.period} 由 ${doc.leave_info.proxy} 代理`;
                    }
                }
            }
        }
        document.getElementById('edit-doc-bed-str').value = bedStr;
        document.getElementById('edit-doc-leave-period').value = leavePeriod;

        this.doctorEditModal.classList.add('show');
    }

    saveDoctorEdit() {
        const origWard = document.getElementById('edit-doc-orig-ward').value;
        const origCode = document.getElementById('edit-doc-orig-code').value;
        const newWard = document.getElementById('edit-doc-ward').value;
        const newName = document.getElementById('edit-doc-name').value.trim();
        const newCode = document.getElementById('edit-doc-code').value.trim();
        const newBedStr = document.getElementById('edit-doc-bed-str').value.trim();
        const leaveStr = document.getElementById('edit-doc-leave-period').value.trim();

        if (!newName || !newCode) {
            this.showToast("醫師姓名與燈號代碼為必填欄位！", "warning");
            return;
        }

        if (!this.manager.data) this.manager.data = { wards: {}, leaves: [] };
        if (!this.manager.data.wards) this.manager.data.wards = {};
        if (!this.manager.data.leaves) this.manager.data.leaves = [];

        const normOrigWard = this.manager._normalizeWardName(origWard);
        const normNewWard = this.manager._normalizeWardName(newWard);

        // 移除原病房中的舊醫師
        if (normOrigWard && this.manager.data.wards[normOrigWard] && this.manager.data.wards[normOrigWard].doctors) {
            this.manager.data.wards[normOrigWard].doctors = this.manager.data.wards[normOrigWard].doctors.filter(d => d.code !== origCode && d.name !== newName);
        }

        // 加入新病房
        if (!this.manager.data.wards[normNewWard]) {
            this.manager.data.wards[normNewWard] = { doctors: [], categories: {} };
        }
        if (!this.manager.data.wards[normNewWard].doctors) {
            this.manager.data.wards[normNewWard].doctors = [];
        }

        let leaveInfo = null;
        if (leaveStr) {
            const m = leaveStr.match(/(\S+)\s*由\s*(\S+)\s*代理/);
            if (m) {
                leaveInfo = { doctor: newName, period: m[1], proxy: m[2], raw: `${newName}醫師 ${m[1]} 請假，由 ${m[2]} 醫師代理` };
            } else {
                leaveInfo = { doctor: newName, period: leaveStr, proxy: "未知", raw: `${newName}醫師 ${leaveStr} 請假` };
            }
        }

        const docObj = {
            name: newName,
            code: newCode,
            bed_str: newBedStr,
            beds: parseBedString(newBedStr),
            clean_code: String(newCode).replace(/\D/g, ''),
            leave_info: leaveInfo
        };
        this.manager.data.wards[normNewWard].doctors.push(docObj);

        // 同步更新 this.manager.data.leaves
        this.manager.data.leaves = this.manager.data.leaves.filter(l => l.doctor !== newName && (origCode && l.doctor !== origCode));
        if (leaveInfo) {
            this.manager.data.leaves.push(leaveInfo);
        }
        this.manager.applyLeaves();
        this.manager.normalizePatientBeds();

        this.closeModal('doctor-edit-modal');
        this.renderDoctorsTab();
        this.updateAllWardHighlights();
        this.manager.saveToLocalStorage();
        this.showToast(`已儲存醫師 ${newName} (${newCode}) 資料`, "success");
    }

    deleteDoctor() {
        const origWard = document.getElementById('edit-doc-orig-ward').value;
        const origCode = document.getElementById('edit-doc-orig-code').value;
        const name = document.getElementById('edit-doc-name').value;

        if (!confirm(`確定要刪除醫師 ${name} (${origCode}) 嗎？`)) return;

        const normOrigWard = this.manager._normalizeWardName(origWard);
        if (this.manager.data && this.manager.data.wards && this.manager.data.wards[normOrigWard]) {
            this.manager.data.wards[normOrigWard].doctors = (this.manager.data.wards[normOrigWard].doctors || []).filter(d => d.code !== origCode);
        }

        if (this.manager.data && this.manager.data.leaves) {
            this.manager.data.leaves = this.manager.data.leaves.filter(l => l.doctor !== name);
        }
        this.manager.applyLeaves();
        this.manager.normalizePatientBeds();

        this.closeModal('doctor-edit-modal');
        this.renderDoctorsTab();
        this.updateAllWardHighlights();
        this.manager.saveToLocalStorage();
        this.showToast(`已刪除醫師 ${name}`, "info");
    }

    /* ==========================================================================
       Toast 通知與模態框控制
       ========================================================================== */
    openModal(modalId) {
        const m = document.getElementById(modalId);
        if (m) m.classList.add('show');
    }

    closeModal(modalId) {
        const m = document.getElementById(modalId);
        if (m) m.classList.remove('show');
    }

    showToast(message, type = "info") {
        if (!this.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icon = type === 'success' ? '✓' : (type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : 'ℹ️'));
        toast.innerHTML = `<span style="font-size: 16px;">${icon}</span> <span style="white-space: pre-line;">${message}</span>`;
        this.toastContainer.appendChild(toast);

        // 通知過多時只保留最新兩筆，避免提示訊息持續向上堆疊。
        const visibleToasts = Array.from(this.toastContainer.querySelectorAll('.toast'));
        while (visibleToasts.length > 2) {
            visibleToasts.shift().remove();
        }

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    /* ==========================================================================
       方案 1~4 滑鼠懸停浮動說明方框 (Hover Tooltip)
       ========================================================================== */
    initSchemeTooltips() {
        let tooltipEl = document.getElementById('scheme-hover-tooltip');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.id = 'scheme-hover-tooltip';
            tooltipEl.className = 'scheme-hover-tooltip';
            document.body.appendChild(tooltipEl);
        }

        const schemeDetails = {
            1: {
                title: "方案 1：原本排法 (基準)",
                badge: "基準方案",
                badgeColor: "#64748b",
                desc: "院內簽床之基準演算法，嚴格保障主治醫師專屬本床優先權。",
                rules: [
                    "維持原始病人房型意願，不擅自更改為 2$>2",
                    "採現行常規本床優先與雙空比對機制",
                    "自動試算「先保留雙空」與「先分配雙空」，採用本床佔比最高者輸出",
                    "依循 5 階段：步驟 1 準時本床 ➔ 步驟 1.5 急診本床 ➔ 步驟 2 剩餘本床 ➔ 步驟 3 同病房借床 ➔ 步驟 4 跨病房借床"
                ],
                tip: "👉 點擊標題：左側病房將以此方案著色顯示；📋 點擊複製：直向複製全體排床結果"
            },
            2: {
                title: "方案 2：雙空依性別缺額優先",
                badge: "雙空性別調配 (0 Delay)",
                badgeColor: "#0d9488",
                desc: "全面分析全院男女性別缺額，動態調配並鎖定雙空房性別，極大化病床利用率。",
                rules: [
                    "意願可自費者將 2>2$ 校正為 2$>2，優先媒合差額雙人床 (榮民雙人差額補助 2$>2>4)",
                    "全面統計全院男女性別缺額，動態調配並鎖定雙空房性別",
                    "雙空全部用滿不浪費，達成全院病患全員入住 (0 Delay)！"
                ],
                tip: "👉 點擊標題：左側病房將以此方案著色顯示；📋 點擊複製：直向複製全體排床結果"
            },
            3: {
                title: "方案 3：全域二分圖最大匹配",
                badge: "🚀 極限最佳化 (0 Delay)",
                badgeColor: "#2563eb",
                desc: "以全域二分圖最大權重匹配演算法 (Kuhn-Munkres) 為核心，全域考量全院床位與病患。",
                rules: [
                    "以全域二分圖最大權重匹配與雙空性別動態回溯分支求解",
                    "徹底根除局部貪婪排床誤殺，極大化總簽床率 (0 Delay)",
                    "非優先借床醫師規則：向 1772、5383、5380、1403 借床扣 4,000 分，僅在無其他床時作為最後防線借用"
                ],
                tip: "👉 點擊標題：左側病房將以此方案著色顯示；📋 點擊複製：直向複製全體排床結果"
            },
            4: {
                title: "方案 4：步驟2本床後全域二分圖匹配 (推薦)",
                badge: "🌟 推薦方案 (兼顧本床與 0 Delay)",
                badgeColor: "#059669",
                desc: "步驟 2 前嚴格保障主治醫師專屬本床優先權，後續借床交由全域二分圖求解最佳借床。",
                rules: [
                    "步驟 2 前嚴格保障主治醫師專屬本床優先權 (抵達、急診、常規本床優先)",
                    "步驟 2 結束後，剩餘待排病人與可用空床交由全域二分圖求解最佳借床",
                    "完美平衡主治醫師本床權益與全院 0 Delay，兼具專業倫理與資源效率",
                    "非優先借床醫師規則：向 1772、5383、5380、1403 借床扣 4,000 分，僅在無其他床時借用"
                ],
                tip: "👉 點擊標題：左側病房將以此方案著色顯示；📋 點擊複製：直向複製全體排床結果"
            }
        };

        const updatePos = (e) => {
            const pad = 14;
            let left = e.clientX + 16;
            let top = e.clientY + 16;
            const rect = tooltipEl.getBoundingClientRect();
            if (left + rect.width > window.innerWidth - pad) {
                left = e.clientX - rect.width - 16;
            }
            if (top + rect.height > window.innerHeight - pad) {
                top = e.clientY - rect.height - 16;
            }
            if (left < pad) left = pad;
            if (top < pad) top = pad;
            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
        };

        document.addEventListener('mouseover', (e) => {
            const th = e.target.closest('#th-scheme-1, #th-scheme-2, #th-scheme-3, #th-scheme-4, #th-p-scheme-1, #th-p-scheme-2, #th-p-scheme-3, #th-p-scheme-4, [data-scheme-tooltip]');
            if (th) {
                let sIdx = th.getAttribute('data-scheme-tooltip');
                if (!sIdx) {
                    const m = th.id.match(/(?:th-scheme-|th-p-scheme-)([1-4])/);
                    if (m) sIdx = m[1];
                }
                if (sIdx && schemeDetails[sIdx]) {
                    const data = schemeDetails[sIdx];
                    tooltipEl.innerHTML = `
                        <div class="scheme-tooltip-header">
                            <span class="scheme-tooltip-title">${data.title}</span>
                            <span class="scheme-tooltip-badge" style="background: ${data.badgeColor};">${data.badge}</span>
                        </div>
                        <div class="scheme-tooltip-desc">${data.desc}</div>
                        <ul class="scheme-tooltip-rules">
                            ${data.rules.map(r => `<li>${r}</li>`).join('')}
                        </ul>
                        <div class="scheme-tooltip-tip">${data.tip}</div>
                    `;
                    tooltipEl.classList.add('show');
                    updatePos(e);
                }
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (tooltipEl.classList.contains('show')) {
                updatePos(e);
            }
        });

        document.addEventListener('mouseout', (e) => {
            const th = e.target.closest('#th-scheme-1, #th-scheme-2, #th-scheme-3, #th-scheme-4, #th-p-scheme-1, #th-p-scheme-2, #th-p-scheme-3, #th-p-scheme-4, [data-scheme-tooltip]');
            if (th) {
                const related = e.relatedTarget ? e.relatedTarget.closest('#th-scheme-1, #th-scheme-2, #th-scheme-3, #th-scheme-4, #th-p-scheme-1, #th-p-scheme-2, #th-p-scheme-3, #th-p-scheme-4, [data-scheme-tooltip]') : null;
                if (!related || related !== th) {
                    tooltipEl.classList.remove('show');
                }
            }
        });

        window.addEventListener('scroll', () => {
            tooltipEl.classList.remove('show');
        }, true);
    }

    /* ==========================================================================
       系統規則與房價資訊分頁渲染 (Rules Tab)
       ========================================================================== */
    renderRulesTab() {
        if (!this.rulesContentContainer) return;

        const yvStr = this.manager ? this.manager.getYoungVNames() : "";
        const yvDisplay = yvStr || "尚未指定 (可於主畫面上方隨時輸入)";

        const rawExts = (this.manager.data && (this.manager.data.extensions || (this.manager.data.rules_and_info && this.manager.data.rules_and_info.extensions))) || [
            "EICU: 86097~8, 內急: 86105~8, 留觀(一): 86115~8(二): 86119~20, 三診: 86086~7, 外急: 86080~3, OPD 7427 (6) RAD 7594, 3086, R- 1380排TACE: 7594  ECDT480030, 胃鏡登記室:1300, 第2室:1302, 腹超室: 2149, ERCP:2055 秀薇290666"
        ];
        const rawPricing = (this.manager.data && (this.manager.data.pricing || (this.manager.data.rules_and_info && this.manager.data.rules_and_info.pricing))) || [
            "房價 (2人):  122: 2400;單人: 5000; 119: 12000; 192: 8600/129: 20000 (阿娥姐 390485)"
        ];
        const rawRules = (this.manager.data && (this.manager.data.rules || (this.manager.data.rules_and_info && this.manager.data.rules_and_info.rules))) || [
            "121,123, 124,113: (除單人之外)皆健保床      122: 1-5, 42-46 健保,其餘差額",
            "121病房34-37床, 122病房36-37床, 123病房36-37床為普通隔離床"
        ];

        this.rulesContentContainer.innerHTML = `
            <div class="rules-container">
                <!-- 頂部橫幅 -->
                <div class="rules-hero">
                    <div>
                        <h2>🏥 病房簽床智慧排床規則與全院房價手冊</h2>
                        <p>整合臨床醫療排床準則、17 條核心排床規則、四大排床方案策略機制與全院病房差額標準。</p>
                    </div>
                    <div style="font-size: 12px; color: var(--text-dim);">
                        系統版本: ${(this.manager.data && this.manager.data.version) || 'v2.0'} | 離線智慧核心
                    </div>
                </div>

                <!-- 方案 1~4 策略比較指南 -->
                <div class="rules-section-card">
                    <div class="rules-section-title">
                        <span>📊</span> 四大排床方案（方案 1 ~ 4）策略比較與原理指南
                    </div>
                    <div class="scheme-overview-grid">
                        <div class="scheme-card" style="border-top: 3px solid #64748b;">
                            <div class="scheme-card-header">
                                <span class="scheme-card-title">方案 1：原本排法 (基準)</span>
                                <span class="scheme-card-badge" style="background: #64748b;">基準方案</span>
                            </div>
                            <div class="scheme-card-body">
                                院內簽床之基準方案，嚴格保障主治醫師專屬本床優先權。
                            </div>
                            <ul class="scheme-card-list">
                                <li>維持原始病人房型意願，不擅自更改為 2$>2</li>
                                <li>採現行常規本床優先與雙空比對機制</li>
                                <li>嚴格依序執行 5 階段排床流程</li>
                                <li>自動試算保留雙空 vs 先分雙空，擇本床佔比最高者輸出</li>
                            </ul>
                        </div>

                        <div class="scheme-card" style="border-top: 3px solid #0d9488;">
                            <div class="scheme-card-header">
                                <span class="scheme-card-title">方案 2：雙空依性別缺額優先</span>
                                <span class="scheme-card-badge" style="background: #0d9488;">雙空性別調配</span>
                            </div>
                            <div class="scheme-card-body">
                                全面分析全院男女性別缺額，動態調配並鎖定雙空房性別，極大化病床利用率。
                            </div>
                            <ul class="scheme-card-list">
                                <li>意願可自費者將 2>2$ 校正為 2$>2 (榮民 2$>2>4)</li>
                                <li>全面統計全院男女性別缺額，動態調配雙空房性別</li>
                                <li>雙空全部用滿不浪費，達成全院病患 0 Delay</li>
                            </ul>
                        </div>

                        <div class="scheme-card" style="border-top: 3px solid #2563eb;">
                            <div class="scheme-card-header">
                                <span class="scheme-card-title">方案 3：全域二分圖最大匹配</span>
                                <span class="scheme-card-badge" style="background: #2563eb;">🚀 極限最佳化</span>
                            </div>
                            <div class="scheme-card-body">
                                以匈牙利二分圖最大權重匹配為核心，全域考量全院床位與待排病患。
                            </div>
                            <ul class="scheme-card-list">
                                <li>全域二分圖匹配與雙空性別動態回溯求解</li>
                                <li>徹底根除局部貪婪排床誤殺，極大化總簽床率 (0 Delay)</li>
                                <li><strong>非優先借床防線</strong>：向 1772、5383、5380、1403 借床扣 4,000 分，僅在無其他床時作為最後防線借用</li>
                            </ul>
                        </div>

                        <div class="scheme-card" style="border-top: 3px solid #059669;">
                            <div class="scheme-card-header">
                                <span class="scheme-card-title">方案 4：步驟2後全域二分圖 (推薦)</span>
                                <span class="scheme-card-badge" style="background: #059669;">🌟 推薦方案</span>
                            </div>
                            <div class="scheme-card-body">
                                步驟 2 前保障主治醫師專屬本床，後續借床交由全域二分圖求解最佳借床。
                            </div>
                            <ul class="scheme-card-list">
                                <li>步驟 2 前嚴格保障主治醫師本床權益 (抵達、急診、常規)</li>
                                <li>步驟 2 結束後，剩餘病人與空床交由二分圖求解</li>
                                <li>兼顧主治醫師專屬床與全院 0 Delay，兼具專業倫理與資源效率</li>
                                <li><strong>非優先借床防線</strong>：向 1772、5383、5380、1403 借床扣 4,000 分，僅在無其他床時借用</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <!-- ⚙️ 核心排床詳細規則 (全 17 條) -->
                <div class="rules-section-card">
                    <div class="rules-section-title">
                        <span>⚙️</span> 核心排床與簽床詳細規則 (全 17 條臨床手冊)
                    </div>
                    <div class="rules-detailed-list">
                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 1</span>
                                <span class="rule-item-title">急診病人 (ER/EICU) 判定與排床 3 位階體系</span>
                            </div>
                            <div class="rule-item-content">
                                <ul>
                                    <li><strong>辨識來源</strong>：檢視病人名單之「聯絡/抗凝」、「抵達通知」、「其他備註」、「房型意願」四大欄位，若包含 EICU、ER 或「急診」字樣（精確詞邊界比對，排除 ERCP、ERBD、liver 等臨床處置或名詞誤判），即判定為急診病人。</li>
                                    <li><strong>第一位階（最優先）</strong>：抵達通知包含「準時」二字之病人，每個位階均最先排 1782 病人（其餘在配床醫師隨機，主治醫師不在醫師配床名冊者置於該位階最後處理），比對主治醫師本床（1782 比對本床時一併納入 1691/1699 符合房型之床位）。</li>
                                    <li><strong>第二位階（次優先）</strong>：有指定主治醫師之急診病人（ER/EICU）。此病人群位階比所有沒有準時的病人優先，但排在準時病人後面；排序方式亦最先排 1782 病人（其餘在配床醫師隨機，不在配床者置底），比對主治醫師本床（1782 比對本床時一併納入 1691/1699 符合房型之床位）。</li>
                                    <li><strong>第三位階（一般待排）</strong>：普通病人與未指定主治醫師之急診病人，同樣最先排 1782 病人（其餘在配床醫師隨機，不在配床者置底），依照「Delay 天數多者優先」比對主治本床（1782 比對本床時一併納入 1691/1699 符合房型之床位）。無主治醫師之急診病人因無本床，保留至後續借床步驟。</li>
                                </ul>
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 2</span>
                                <span class="rule-item-title">嚴格五大階段排床程序</span>
                            </div>
                            <div class="rule-item-content">
                                <ul>
                                    <li><strong>步驟 1</strong>：抵達通知中優先病人（僅限含「準時」二字）依意願比對主治醫師本床（1782 最先排且納入 1691/1699 支援床，其他在配床醫師隨機，不在配床醫師置底）。</li>
                                    <li><strong>步驟 1.5</strong>：有主治醫師之急診優先病人（ER/EICU），位階優先於未準時病人，依意願比對主治醫師本床（1782 最先排且納入 1691/1699 支援床，其他在配床醫師隨機，不在配床醫師置底）。</li>
                                    <li><strong>步驟 2</strong>：剩餘待排病人（包含無主治急診病人與普通未準時病人）最先排 1782 病人（納入 1691/1699 支援床），再依 Delay 天數多者與隨機順序比對主治醫師本床；不在配床醫師置底。</li>
                                    <li><strong>步驟 3</strong>：步驟 1（準時）與步驟 1.5（急診優先）未排定本床之病人，向同病房其他主治醫師借床；優先填入同病房但「不是優先借床」之一般主治醫師床位。</li>
                                    <li><strong>步驟 4</strong>：剩餘所有未排定病人依序向同病房、跨病房借床（跨病房借床時，急診病人優先分配 Young V 醫師床位）；全院無合適空床則累加延後天數為 delay + 空格 + 數字。</li>
                                    <li><strong>同位階排序與隨機原則</strong>：每個位階均優先處理 1782 病人；其餘在配床主治醫師採隨機順序公平排床；主治醫師不在醫師配床名單者一律放到該位階最後處理。同群內依 Delay 天數與<strong>校正後意願最少</strong>的病人優先（MRV 最小剩餘意願啟發式）。校正後只有 1 種房型意願者，優先排<strong>只有 1</strong> 的病人，再排<strong>只有 2$</strong> 的病人，再排<strong>只有 2</strong> 與 <strong>只有 4</strong> 的病人；同條件下順序採隨機亂數排床。</li>
                                </ul>
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 3</span>
                                <span class="rule-item-title">主治醫師請假之床位規則</span>
                            </div>
                            <div class="rule-item-content">
                                平日與初期不更換床位歸屬，請假醫師自己的病人仍可排入其本床；若代理醫師有病人住院且自身無本床，後續步驟優先將請假醫師之床位提供給代理醫師使用。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 4</span>
                                <span class="rule-item-title">124 核心醫師集中 124 病房規範</span>
                            </div>
                            <div class="rule-item-content">
                                1699、1691、1782 醫師病人盡量都放在 124 病房；除非 124 沒有合適床位才允許向其他病房借床。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 5</span>
                                <span class="rule-item-title">全院同病房集中照護（方便查房原則）</span>
                            </div>
                            <div class="rule-item-content">
                                簽床借床時盡量安排在原主治醫師所屬病房內，減少跨病房奔波。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 6</span>
                                <span class="rule-item-title">Young V 醫師燈號名單與急診優選收治</span>
                            </div>
                            <div class="rule-item-content">
                                目前設定之 Young V 醫師名單為：<strong>${yvDisplay}</strong>。適合收治急診（ER）簽床病人，急診病人跨病房借床時將優先安排給 Young V 醫師或其床位。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 7</span>
                                <span class="rule-item-title">房型意願與榮民差額補助規範</span>
                            </div>
                            <div class="rule-item-content">
                                房型意願包含「單」、「單人」、「1」字樣視同可住 2$ 差額雙人床或自費單人床；包含「榮」或「榮民」字樣者統一預設校正為 <strong>2$>2>4</strong>（榮民雙人差額補助，首選差額雙人床 2$，次選健保雙人床 2，無雙人床可住 4 人床）。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 8</span>
                                <span class="rule-item-title">健保房型與 4 人床意願規範</span>
                            </div>
                            <div class="rule-item-content">
                                健保床、健保、或 健保2、2人優先 都應該視為 <strong>2>4</strong>（雙人床優先，無雙人床可住 4 人床）；除非有「必健保2」這類字樣（如必健保2、健保2 only、只要健保2、必2等）或未含 4 之自費高階房型（單人/差額/榮民），才是只有 2，絕對不能使用 4 人床，無雙人床時應列為 delay 延後住院。
                            </div>
                        </div>

                        <div class="rule-item-box alert-rule">
                            <div class="rule-item-header">
                                <span class="rule-number-badge" style="background: var(--warning-light); color: var(--warning-hover);">規則 9</span>
                                <span class="rule-item-title">借床禁令與非優先借床醫師規範</span>
                            </div>
                            <div class="rule-item-content">
                                <ul>
                                    <li><strong>互借禁令</strong>：1782 與 1772 嚴格禁止互借。</li>
                                    <li><strong>病房限制</strong>：1772 不能借 124 的床位；1782 不能借 121 的床位；1782 床位不借給非 124 醫師。</li>
                                    <li><strong>雙空床位</strong>：雙空床位優先給原本主治醫師，但借出亦可（避免明明有雙空卻讓病人延後住院）。</li>
                                    <li><strong>非優先借床醫師</strong>：<code>{'1772', '5383', '5380', '1403'}</code> 之床位列為<strong>非優先借床</strong>。全方案（包含方案 1、2、3、4）均進行嚴格權重扣分（二分圖匹配扣 4,000 分），僅在全院無其他床位可滿足該病人時，作為最後防線借用。</li>
                                </ul>
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 10</span>
                                <span class="rule-item-title">隔離床入住規範</span>
                            </div>
                            <div class="rule-item-content">
                                隔離床可以是男生也可以是女生住，視同「健保雙人床（可為男或女）」，可安排男性或女性病人入住。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 11</span>
                                <span class="rule-item-title">雙空房成組規則、不移格與智慧背景變色</span>
                            </div>
                            <div class="rule-item-content">
                                雙空床位每兩個數字為一組（同房必須同性別）；雙空被排定後數字保留在原本雙空格內，不移動到男2/女2；男生入住床號以藍色背景白字呈現，女生以紅色背景白字呈現，未排定床位維持純白背景黑字（所有床位變色比照辦理）。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 12</span>
                                <span class="rule-item-title">排不出床 Delay 天數累加機制</span>
                            </div>
                            <div class="rule-item-content">
                                若病人無合適空床可排，狀態自動標記為 delay + 空格 + 數字（原無 delay 轉為 delay 1，原本 delay 1 累加為 delay 2，以此類推）。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 13</span>
                                <span class="rule-item-title">輸入時已指定床位處理與保護鎖定</span>
                            </div>
                            <div class="rule-item-content">
                                從輸入的狀態/床位中自動擷取 '-' 前後數字（如 A113 - 5 修正為 113-5，124-35 修正為 124-35），該病人手動排入之床位作為最終排床結果，自動排床絕不覆蓋；該床位視為已被佔用且自可用床位池扣除，介面床號立即標註為紅字。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 14</span>
                                <span class="rule-item-title">1782 醫師全位階最先排床與 1691、1699 床位納入可用床位</span>
                            </div>
                            <div class="rule-item-content">
                                <ul>
                                    <li><strong>全位階最先排 1782</strong>：在每個位階（準時本床、急診本床、一般本床、以及各借床階段）中，均最優先排定 1782（黃怡翔）醫師之病人；其餘在配床主治醫師採隨機順序處理；主治醫師不在醫師配床名冊者一律移至該位階最後處理。</li>
                                    <li><strong>本床比對納入 1691/1699 床位</strong>：1782 醫師比對本床時，1691（齊振達）與 1699（吳啟榮）醫師之符合房型床位亦一併納入 1782 的可用床位（1782 本人床位優先，不足時由 1691/1699 支援借用）。</li>
                                    <li><strong>其他主治醫師隨機原則</strong>：除 1782 最先排之外，其餘有配床的主治醫師之間無固定特權階梯，同天數同條件下採隨機亂數公平排序。</li>
                                </ul>
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 15</span>
                                <span class="rule-item-title">短天數住院借床優先規則</span>
                            </div>
                            <div class="rule-item-content">
                                備註包含一日、三天兩夜、兩天一夜、3天2夜等病人，表示病人住院天數不多（1~3天即出院），對出借醫師影響最小，為最適合向其他醫師借床之人選，在借床排位時優先安排借床。
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 16</span>
                                <span class="rule-item-title">特種高級單人房 (192、119、129) 與「不限價位必單人」排床規則</span>
                            </div>
                            <div class="rule-item-content">
                                <ul>
                                    <li><strong>不限價位意願</strong>：房型意願若為「不限價位必單人」（或包含「不限價位」），系統校正後意願視同 <code>1>1(192)>1(119)>1(129)</code>。</li>
                                    <li><strong>純他科高級單人房意願</strong>（如 1(192)、1(119)、1(129) 等）：不需要排本院病床，原則上跟其他科借床，狀態直接寫 192、119 或 129 即可（視同後續向他科手動借床），不佔用本院 113~124 可用空床，且不列入 delay。</li>
                                    <li><strong>含本院單人床候補者</strong>（如 1(192)>1 或 1>1(192)>1(119)>1(129)）：系統會優先替病人搜尋本院可用單人床（嚴格限單人床，不降轉雙人或四人床）；若全院皆無可用單人床，則依規則直接填入 192（視同轉向他科手動借床），標記為已排床且不列入 delay。</li>
                                </ul>
                            </div>
                        </div>

                        <div class="rule-item-box">
                            <div class="rule-item-header">
                                <span class="rule-number-badge">規則 17</span>
                                <span class="rule-item-title">狀態/床位之借床燈號規範（數字燈號而非名字）</span>
                            </div>
                            <div class="rule-item-content">
                                若向其他醫師借床（包含同病房借床、跨病房借床或代理借床），在「狀態/床位」欄位請一律直接標記被借醫師之<strong>數字燈號而非名字</strong>，格式如 <code>121-25 (5383)</code> 或 <code>124-2 (1691)</code>；若有代班情況請填入代班主治醫師燈號如 <code>121-25 (6410)</code>，刪除「借床-」等字眼，以利直接複製整欄貼上 Excel / Google Sheet。
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 💰 病房收費與差額標準 -->
                <div class="rules-section-card">
                    <div class="rules-section-title">
                        <span>💰</span> 病房收費與健保/差額/隔離床標準規則
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        ${rawPricing.map(p => `<div style="background: var(--bg-subtle); padding: 10px 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--accent-teal); font-size: 13px;">💰 ${p}</div>`).join('')}
                        ${rawRules.map(r => `<div style="background: var(--bg-subtle); padding: 10px 14px; border-radius: var(--radius-sm); border-left: 4px solid var(--primary); font-size: 13px;">📋 ${r}</div>`).join('')}
                    </div>
                </div>

                <!-- 📞 常用分機號碼 -->
                <div class="rules-section-card">
                    <div class="rules-section-title">
                        <span>📞</span> 常用急診、檢查室與分機號碼
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        ${rawExts.map(e => `<div style="background: var(--bg-subtle); padding: 10px 14px; border-radius: var(--radius-sm); border-left: 4px solid #f59e0b; font-size: 13px; font-family: var(--font-mono); line-height: 1.6;">${e}</div>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }
}

// 實例化全域 App
window.addEventListener('DOMContentLoaded', () => {
    window.app = new BedAnalyzerApp();
});
