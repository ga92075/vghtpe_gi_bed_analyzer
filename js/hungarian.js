/**
 * Kuhn-Munkres (匈牙利演算法 / 最小費用最大匹配) Pure JavaScript 實現
 * 完全對照 bed_analyzer.pyw 中之 _pure_python_linear_sum_assignment
 * 支援任意 N x M 矩陣，時間複雜度 O(N^2 * M)
 */
function linearSumAssignment(costMatrix) {
    const n = costMatrix.length;
    if (n === 0) {
        return [[], []];
    }
    const m = costMatrix[0].length;

    // 若行數大於列數，轉置矩陣計算後再對調結果
    if (n > m) {
        const transposed = [];
        for (let j = 0; j < m; j++) {
            const row = [];
            for (let i = 0; i < n; i++) {
                row.push(costMatrix[i][j]);
            }
            transposed.push(row);
        }
        const [rInd, cInd] = linearSumAssignment(transposed);
        const pairs = [];
        for (let k = 0; k < rInd.length; k++) {
            pairs.push([cInd[k], rInd[k]]);
        }
        pairs.sort((a, b) => a[0] - b[0]);
        return [pairs.map(p => p[0]), pairs.map(p => p[1])];
    }

    const u = new Array(n + 1).fill(0.0);
    const v = new Array(m + 1).fill(0.0);
    const p = new Array(m + 1).fill(0);
    const way = new Array(m + 1).fill(0);

    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = new Array(m + 1).fill(Infinity);
        const used = new Array(m + 1).fill(false);

        while (true) {
            used[j0] = true;
            const i0 = p[j0];
            let delta = Infinity;
            let j1 = 0;

            for (let j = 1; j <= m; j++) {
                if (!used[j]) {
                    const cur = costMatrix[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if (minv[j] < delta) {
                        delta = minv[j];
                        j1 = j;
                    }
                }
            }

            for (let j = 0; j <= m; j++) {
                if (used[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }

            j0 = j1;
            if (p[j0] === 0) {
                break;
            }
        }

        while (true) {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
            if (j0 === 0) {
                break;
            }
        }
    }

    const rowInd = [];
    const colInd = [];
    for (let j = 1; j <= m; j++) {
        if (p[j] !== 0) {
            rowInd.push(p[j] - 1);
            colInd.push(j - 1);
        }
    }

    const pairs = [];
    for (let k = 0; k < rowInd.length; k++) {
        pairs.push([rowInd[k], colInd[k]]);
    }
    pairs.sort((a, b) => a[0] - b[0]);

    return [pairs.map(p => p[0]), pairs.map(p => p[1])];
}

// 支援 Node.js 環境匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { linearSumAssignment };
}
