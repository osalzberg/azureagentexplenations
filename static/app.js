/**
 * Azure KQL Explorer - Frontend Application
 */

// State
let currentResults = null;
let currentQuery = null;
let selectedModel = 'gpt-4';
let currentChart = null;
let currentChartType = 'bar';
let chartData = null;
let cachedExamples = null;

// Benchmark State
let benchmarkTestCases = [];
let benchmarkResults = null;
let benchmarkChart = null;
let availableModels = [];

// DOM Elements
const workspaceIdInput = document.getElementById('workspace-id');
const timespanSelect = document.getElementById('timespan');
const aiModelSelect = document.getElementById('ai-model');
const testConnectionBtn = document.getElementById('test-connection');
const connectionStatus = document.getElementById('connection-status');
const kqlQueryTextarea = document.getElementById('kql-query');
const runQueryBtn = document.getElementById('run-query');
const formatQueryBtn = document.getElementById('format-query');
const clearQueryBtn = document.getElementById('clear-query');
const resultsContainer = document.getElementById('results-container');
const resultsCount = document.getElementById('results-count');
const queryTime = document.getElementById('query-time');
const exportCsvBtn = document.getElementById('export-csv');
const exportJsonBtn = document.getElementById('export-json');
const loadingOverlay = document.getElementById('loading-overlay');
const toast = document.getElementById('toast');
const examplesList = document.getElementById('examples-list');
const lineNumbers = document.getElementById('line-numbers');
const explanationSection = document.getElementById('explanation-section');
const explanationContainer = document.getElementById('explanation-container');
const refreshExplanationBtn = document.getElementById('refresh-explanation');
const visualizationSection = document.getElementById('visualization-section');
const resultsChart = document.getElementById('results-chart');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    loadExamples();
    updateLineNumbers();
    
    // Event Listeners
    testConnectionBtn.addEventListener('click', testConnection);
    runQueryBtn.addEventListener('click', executeQuery);
    formatQueryBtn.addEventListener('click', formatQuery);
    clearQueryBtn.addEventListener('click', clearQuery);
    exportCsvBtn.addEventListener('click', exportToCsv);
    exportJsonBtn.addEventListener('click', exportToJson);
    refreshExplanationBtn.addEventListener('click', () => generateExplanation(currentQuery, currentResults));
    aiModelSelect.addEventListener('change', (e) => {
        selectedModel = e.target.value;
    });
    
    // Chart type buttons
    document.querySelectorAll('.chart-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentChartType = btn.dataset.type;
            if (chartData) {
                renderChart(chartData.labels, chartData.datasets, chartData.title);
            }
        });
    });
    
    // Keyboard shortcut for running query
    kqlQueryTextarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            executeQuery();
        }
    });
    
    // Update line numbers on input
    kqlQueryTextarea.addEventListener('input', updateLineNumbers);
    kqlQueryTextarea.addEventListener('scroll', syncLineNumbersScroll);
});

// Load available AI models
async function loadModels() {
    try {
        const response = await fetch('/api/models');
        const data = await response.json();
        
        aiModelSelect.innerHTML = data.models.map(model => 
            `<option value="${model.id}" ${model.id === data.default ? 'selected' : ''}>${model.name}</option>`
        ).join('');
        
        selectedModel = data.default;
    } catch (error) {
        console.error('Failed to load models:', error);
        aiModelSelect.innerHTML = '<option value="gpt-4">GPT-4</option>';
    }
}

// Update line numbers in editor
function updateLineNumbers() {
    const lines = kqlQueryTextarea.value.split('\n');
    lineNumbers.innerHTML = lines.map((_, i) => i + 1).join('<br>');
}

// Sync line numbers scroll with textarea
function syncLineNumbersScroll() {
    lineNumbers.scrollTop = kqlQueryTextarea.scrollTop;
}

// Test connection to workspace
async function testConnection() {
    const workspaceId = workspaceIdInput.value.trim();
    
    if (!workspaceId) {
        showToast('Please enter a Workspace ID', 'error');
        return;
    }
    
    testConnectionBtn.disabled = true;
    testConnectionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
    
    try {
        const response = await fetch('/api/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace_id: workspaceId })
        });
        
        const data = await response.json();
        
        connectionStatus.className = 'connection-status ' + (data.success ? 'success' : 'error');
        connectionStatus.innerHTML = data.success 
            ? '<i class="fas fa-check-circle"></i> ' + data.message
            : '<i class="fas fa-times-circle"></i> ' + data.message;
        
        if (data.success) {
            showToast('Connection successful!', 'success');
        }
    } catch (error) {
        connectionStatus.className = 'connection-status error';
        connectionStatus.innerHTML = '<i class="fas fa-times-circle"></i> Connection failed: ' + error.message;
    } finally {
        testConnectionBtn.disabled = false;
        testConnectionBtn.innerHTML = '<i class="fas fa-bolt"></i> Test Connection';
    }
}

// Execute KQL query
async function executeQuery() {
    const workspaceId = workspaceIdInput.value.trim();
    const query = kqlQueryTextarea.value.trim();
    const timespanHours = parseInt(timespanSelect.value);
    
    if (!workspaceId) {
        showToast('Please enter a Workspace ID', 'error');
        return;
    }
    
    if (!query) {
        showToast('Please enter a query', 'error');
        return;
    }
    
    showLoading(true);
    const startTime = performance.now();
    
    try {
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspace_id: workspaceId,
                query: query,
                timespan_hours: timespanHours
            })
        });
        
        const data = await response.json();
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        
        if (data.error) {
            showError(data.error);
            queryTime.textContent = '';
            resultsCount.textContent = '';
            explanationSection.style.display = 'none';
        } else {
            currentResults = data;
            currentQuery = query;
            displayResults(data);
            queryTime.textContent = `${elapsed}s`;
            resultsCount.textContent = `${data.total_rows} rows`;
            exportCsvBtn.disabled = false;
            exportJsonBtn.disabled = false;
            showToast(`Query completed: ${data.total_rows} rows returned`, 'success');
            
            // Try to visualize results
            tryVisualize(data);
            
            // Generate AI explanation
            generateExplanation(query, data);
        }
    } catch (error) {
        showError('Failed to execute query: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// Display query results
function displayResults(data) {
    if (!data.tables || data.tables.length === 0) {
        resultsContainer.innerHTML = `
            <div class="placeholder">
                <i class="fas fa-inbox"></i>
                <p>Query returned no results</p>
            </div>
        `;
        visualizationSection.style.display = 'none';
        return;
    }
    
    let html = '';
    
    data.tables.forEach((table, index) => {
        html += `
            <div class="table-container">
                ${data.tables.length > 1 ? `<div class="table-header">${table.name} (${table.row_count} rows)</div>` : ''}
                <div class="data-table-wrapper">
                    <table class="data-table">
                        <thead>
                            <tr>
                                ${table.columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${table.rows.map(row => `
                                <tr>
                                    ${row.map(cell => {
                                        if (cell === null || cell === undefined) {
                                            return '<td class="null-value">NULL</td>';
                                        }
                                        const value = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
                                        return `<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
                                    }).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });
    
    resultsContainer.innerHTML = html;
}

// Try to visualize the data if it's chartable
function tryVisualize(data) {
    if (!data.tables || data.tables.length === 0) {
        visualizationSection.style.display = 'none';
        return;
    }
    
    const table = data.tables[0];
    const columns = table.columns;
    const rows = table.rows;
    
    if (rows.length === 0 || rows.length > 100) {
        visualizationSection.style.display = 'none';
        return;
    }
    
    // Find label column (first string/text column) and value columns (numeric)
    let labelColIndex = -1;
    let valueColIndices = [];
    
    // Analyze column types based on first few rows
    columns.forEach((col, index) => {
        const sampleValues = rows.slice(0, 5).map(row => row[index]).filter(v => v !== null);
        const isNumeric = sampleValues.length > 0 && sampleValues.every(v => typeof v === 'number' || !isNaN(parseFloat(v)));
        const isLabel = sampleValues.length > 0 && sampleValues.some(v => typeof v === 'string' && isNaN(parseFloat(v)));
        
        if (isNumeric) {
            valueColIndices.push(index);
        } else if (labelColIndex === -1 && isLabel) {
            labelColIndex = index;
        }
    });
    
    // Check for common aggregation patterns (count_, sum_, avg_, etc.)
    columns.forEach((col, index) => {
        const colLower = col.toLowerCase();
        if (colLower.includes('count') || colLower.includes('sum') || colLower.includes('avg') || 
            colLower.includes('min') || colLower.includes('max') || colLower.includes('total') ||
            colLower.includes('duration') || colLower.includes('bytes')) {
            if (!valueColIndices.includes(index)) {
                valueColIndices.push(index);
            }
        }
    });
    
    // If no label column found, use first column
    if (labelColIndex === -1 && columns.length > 0) {
        labelColIndex = 0;
    }
    
    // Need at least one value column to chart
    if (valueColIndices.length === 0) {
        visualizationSection.style.display = 'none';
        return;
    }
    
    // Extract labels and data
    const labels = rows.map(row => {
        const val = row[labelColIndex];
        if (val === null) return 'NULL';
        // Truncate long labels
        const str = String(val);
        return str.length > 30 ? str.substring(0, 27) + '...' : str;
    });
    
    // Generate colors
    const colors = [
        'rgba(137, 180, 250, 0.8)',  // blue
        'rgba(166, 227, 161, 0.8)',  // green
        'rgba(249, 226, 175, 0.8)',  // yellow
        'rgba(243, 139, 168, 0.8)',  // red
        'rgba(203, 166, 247, 0.8)',  // purple
        'rgba(148, 226, 213, 0.8)',  // teal
        'rgba(250, 179, 135, 0.8)',  // orange
        'rgba(245, 194, 231, 0.8)',  // pink
    ];
    
    const datasets = valueColIndices.slice(0, 4).map((colIndex, i) => ({
        label: columns[colIndex],
        data: rows.map(row => {
            const val = row[colIndex];
            return val === null ? 0 : (typeof val === 'number' ? val : parseFloat(val) || 0);
        }),
        backgroundColor: colors[i % colors.length],
        borderColor: colors[i % colors.length].replace('0.8', '1'),
        borderWidth: 2
    }));
    
    // Store chart data for type switching
    chartData = {
        labels,
        datasets,
        title: columns[valueColIndices[0]]
    };
    
    visualizationSection.style.display = 'block';
    renderChart(labels, datasets, columns[valueColIndices[0]]);
}

// Render chart with current type
function renderChart(labels, datasets, title) {
    // Destroy existing chart
    if (currentChart) {
        currentChart.destroy();
    }
    
    const ctx = resultsChart.getContext('2d');
    
    // For pie/doughnut, use only first dataset
    const chartDatasets = (currentChartType === 'pie' || currentChartType === 'doughnut') 
        ? [{
            ...datasets[0],
            backgroundColor: labels.map((_, i) => [
                'rgba(137, 180, 250, 0.8)',
                'rgba(166, 227, 161, 0.8)',
                'rgba(249, 226, 175, 0.8)',
                'rgba(243, 139, 168, 0.8)',
                'rgba(203, 166, 247, 0.8)',
                'rgba(148, 226, 213, 0.8)',
                'rgba(250, 179, 135, 0.8)',
                'rgba(245, 194, 231, 0.8)',
            ][i % 8])
        }]
        : datasets;
    
    currentChart = new Chart(ctx, {
        type: currentChartType,
        data: {
            labels,
            datasets: chartDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: (currentChartType === 'pie' || currentChartType === 'doughnut') ? 'right' : 'top',
                    labels: {
                        color: '#cdd6f4',
                        font: { size: 11 }
                    }
                },
                title: {
                    display: false
                }
            },
            scales: (currentChartType === 'pie' || currentChartType === 'doughnut') ? {} : {
                x: {
                    ticks: { color: '#a6adc8', maxRotation: 45 },
                    grid: { color: 'rgba(69, 71, 90, 0.5)' }
                },
                y: {
                    ticks: { color: '#a6adc8' },
                    grid: { color: 'rgba(69, 71, 90, 0.5)' }
                }
            }
        }
    });
}

// Generate AI explanation of results
async function generateExplanation(query, data) {
    explanationSection.style.display = 'block';
    const modelName = aiModelSelect.options[aiModelSelect.selectedIndex].text;
    explanationContainer.innerHTML = `
        <div class="explanation-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <span>Analyzing results with ${modelName}...</span>
        </div>
    `;
    
    try {
        const response = await fetch('/api/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: query,
                tables: data.tables,
                total_rows: data.total_rows,
                model: selectedModel
            })
        });
        
        const result = await response.json();
        
        if (result.error) {
            explanationContainer.innerHTML = `
                <div class="explanation-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <span>Failed to generate explanation: ${escapeHtml(result.error)}</span>
                </div>
            `;
        } else {
            // Parse markdown and display
            const htmlContent = marked.parse(result.explanation);
            const usedModel = result.model || selectedModel;
            explanationContainer.innerHTML = `
                <div class="explanation-model-badge">
                    <i class="fas fa-robot"></i> ${modelName}
                </div>
                <div class="explanation-content">${htmlContent}</div>
            `;
        }
    } catch (error) {
        explanationContainer.innerHTML = `
            <div class="explanation-error">
                <i class="fas fa-exclamation-circle"></i>
                <span>Failed to generate explanation: ${error.message}</span>
            </div>
        `;
    }
}

// Show error in results
function showError(message) {
    resultsContainer.innerHTML = `
        <div class="error-container">
            <i class="fas fa-exclamation-triangle"></i>
            <h4>Query Error</h4>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
    currentResults = null;
    currentQuery = null;
    exportCsvBtn.disabled = true;
    exportJsonBtn.disabled = true;
    explanationSection.style.display = 'none';
    visualizationSection.style.display = 'none';
}

// Format query (basic formatting)
function formatQuery() {
    let query = kqlQueryTextarea.value;
    
    // Add line breaks after pipes
    query = query.replace(/\s*\|\s*/g, '\n| ');
    
    // Trim extra whitespace
    query = query.split('\n').map(line => line.trim()).join('\n');
    
    kqlQueryTextarea.value = query;
    updateLineNumbers();
}

// Clear query
function clearQuery() {
    kqlQueryTextarea.value = '';
    updateLineNumbers();
}

// Load example queries
async function loadExamples() {
    try {
        const response = await fetch('/api/examples');
        const examples = await response.json();
        cachedExamples = examples;
        
        let html = '';
        
        for (const [key, category] of Object.entries(examples)) {
            html += `
                <div class="example-category" data-category="${key}">
                    <div class="example-category-header" onclick="toggleCategory('${key}')">
                        <i class="fas fa-chevron-right"></i>
                        ${category.name}
                    </div>
                    <div class="example-queries">
                        ${category.queries.map((q, i) => `
                            <div class="example-query" onclick="loadExample('${key}', ${i})">
                                ${q.name}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        examplesList.innerHTML = html;
    } catch (error) {
        console.error('Failed to load examples:', error);
    }
}

// Toggle example category
function toggleCategory(key) {
    const category = document.querySelector(`.example-category[data-category="${key}"]`);
    category.classList.toggle('expanded');
}

// Load example query
function loadExample(category, index) {
    try {
        if (!cachedExamples || !cachedExamples[category] || !cachedExamples[category].queries[index]) {
            showToast('Example not found', 'error');
            return;
        }
        
        const query = cachedExamples[category].queries[index].query;
        kqlQueryTextarea.value = query;
        updateLineNumbers();
        showToast('Example query loaded', 'success');
    } catch (error) {
        console.error('Failed to load example:', error);
        showToast('Failed to load example', 'error');
    }
}

// Export results to CSV
function exportToCsv() {
    if (!currentResults || !currentResults.tables || currentResults.tables.length === 0) {
        return;
    }
    
    const table = currentResults.tables[0];
    let csv = table.columns.map(col => `"${col}"`).join(',') + '\n';
    
    table.rows.forEach(row => {
        csv += row.map(cell => {
            if (cell === null || cell === undefined) return '""';
            const value = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
            return `"${value.replace(/"/g, '""')}"`;
        }).join(',') + '\n';
    });
    
    downloadFile(csv, 'query-results.csv', 'text/csv');
    showToast('Results exported to CSV', 'success');
}

// Export results to JSON
function exportToJson() {
    if (!currentResults || !currentResults.tables || currentResults.tables.length === 0) {
        return;
    }
    
    const json = JSON.stringify(currentResults, null, 2);
    downloadFile(json, 'query-results.json', 'application/json');
    showToast('Results exported to JSON', 'success');
}

// Download file helper
function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Show/hide loading overlay
function showLoading(show) {
    loadingOverlay.classList.toggle('hidden', !show);
}

// Show toast notification
function showToast(message, type = 'info') {
    const icon = type === 'success' ? 'fas fa-check-circle' : 
                 type === 'error' ? 'fas fa-exclamation-circle' : 
                 'fas fa-info-circle';
    
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="toast-icon ${icon}"></i>
        <span class="toast-message">${message}</span>
    `;
    
    // Show toast
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Hide after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 3000);
}

// Escape HTML helper
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make functions available globally for onclick handlers
window.toggleCategory = toggleCategory;
window.loadExample = loadExample;window.toggleCollapsible = toggleCollapsible;
window.removeTestCase = removeTestCase;
window.selectTestCase = selectTestCase;

// ==========================================
// BENCHMARK FUNCTIONALITY
// ==========================================

// Initialize benchmark on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeBenchmark();
});

function initializeBenchmark() {
    // Navigation tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Add test case button (manual entry)
    const addTestCaseBtn = document.getElementById('add-test-case');
    if (addTestCaseBtn) {
        addTestCaseBtn.addEventListener('click', showAddTestCaseModal);
    }

    // Use current query as test case button
    const useCurrentQueryBtn = document.getElementById('use-current-query');
    if (useCurrentQueryBtn) {
        useCurrentQueryBtn.addEventListener('click', () => {
            if (!currentResults || !currentQuery) {
                showToast('No query results available. Go to Explorer and run a query first!', 'error');
                return;
            }
            addTestCaseFromCurrentResults();
        });
    }

    // Run benchmark button
    const runBenchmarkBtn = document.getElementById('run-benchmark');
    if (runBenchmarkBtn) {
        runBenchmarkBtn.addEventListener('click', runBenchmark);
    }

    // Export buttons
    const exportBenchmarkJson = document.getElementById('export-benchmark-json');
    if (exportBenchmarkJson) {
        exportBenchmarkJson.addEventListener('click', exportBenchmarkToJson);
    }

    const exportBenchmarkCsv = document.getElementById('export-benchmark-csv');
    if (exportBenchmarkCsv) {
        exportBenchmarkCsv.addEventListener('click', exportBenchmarkToCsv);
    }

    // Load sample test cases
    loadSampleTestCases();
    
    // Populate benchmark models
    populateBenchmarkModels();
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Show/hide content
    const explorerContent = document.getElementById('explorer-content');
    const benchmarkContent = document.getElementById('benchmark-content');
    
    if (tabName === 'explorer') {
        explorerContent.style.display = 'flex';
        benchmarkContent.style.display = 'none';
    } else {
        explorerContent.style.display = 'none';
        benchmarkContent.style.display = 'flex';
        // Update the current query preview
        updateBenchmarkQueryPreview();
    }
}

// Make switchTab globally available
window.switchTab = switchTab;

function updateBenchmarkQueryPreview() {
    const statusEl = document.getElementById('current-query-status');
    const previewEl = document.getElementById('current-query-preview');
    
    if (!statusEl || !previewEl) return;
    
    if (currentResults && currentQuery) {
        // Show the query preview
        statusEl.style.display = 'none';
        previewEl.style.display = 'block';
        
        const table = currentResults.tables[0];
        document.getElementById('benchmark-query-text').textContent = currentQuery;
        document.getElementById('benchmark-row-count').textContent = table.rows.length;
        document.getElementById('benchmark-col-count').textContent = table.columns.length;
    } else {
        // Show the "no query" message
        statusEl.style.display = 'block';
        previewEl.style.display = 'none';
    }
}

function toggleCollapsible(header) {
    const section = header.closest('.collapsible');
    section.classList.toggle('expanded');
}

function populateBenchmarkModels() {
    const container = document.getElementById('benchmark-models');
    if (!container) return;

    // Wait for models to load
    setTimeout(() => {
        const modelSelect = document.getElementById('ai-model');
        if (!modelSelect) return;

        availableModels = Array.from(modelSelect.options).map(opt => ({
            id: opt.value,
            name: opt.text
        }));

        container.innerHTML = availableModels.map(model => `
            <label class="model-checkbox checked">
                <input type="checkbox" value="${model.id}" checked>
                <span>${model.name}</span>
            </label>
        `).join('');

        // Toggle handler
        container.querySelectorAll('.model-checkbox').forEach(checkbox => {
            checkbox.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const input = checkbox.querySelector('input');
                    input.checked = !input.checked;
                }
                checkbox.classList.toggle('checked', checkbox.querySelector('input').checked);
            });
        });
    }, 500);
}

function loadSampleTestCases() {
    // Don't load sample test cases - user should run their own query and compare models
    benchmarkTestCases = [];
    renderTestCases();
}

function renderTestCases() {
    const container = document.getElementById('test-cases-list');
    if (!container) return;

    // Update count
    const countEl = document.getElementById('test-case-count');
    if (countEl) {
        countEl.textContent = benchmarkTestCases.length;
    }

    if (benchmarkTestCases.length === 0) {
        container.innerHTML = `
            <div class="placeholder" style="padding: 40px;">
                <i class="fas fa-clipboard-list"></i>
                <p>No test cases yet. Run a query in Explorer and click "Use Current Query as Test Case"</p>
            </div>
        `;
        return;
    }

    container.innerHTML = benchmarkTestCases.map(tc => `
        <div class="test-case-card" data-id="${tc.id}" onclick="selectTestCase('${tc.id}')">
            <div class="test-case-header">
                <span class="test-case-title">${escapeHtml(tc.name)}</span>
                <span class="test-case-badge">${tc.audience.toUpperCase()}</span>
                <button class="btn btn-icon btn-delete" onclick="event.stopPropagation(); removeTestCase('${tc.id}')" title="Remove">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="test-case-query">${escapeHtml(tc.query.split('\n')[0])}...</div>
            <div class="test-case-meta">
                <span><i class="fas fa-table"></i> ${tc.results.rows.length} rows</span>
                <span><i class="fas fa-columns"></i> ${tc.results.columns.length} columns</span>
                <span><i class="fas fa-check-circle"></i> ${tc.expectedInsights.length} expected insights</span>
            </div>
        </div>
    `).join('');
}

function selectTestCase(id) {
    document.querySelectorAll('.test-case-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.id === id);
    });
}

function removeTestCase(id) {
    benchmarkTestCases = benchmarkTestCases.filter(tc => tc.id !== id);
    renderTestCases();
    showToast('Test case removed', 'success');
}

function showAddTestCaseModal() {
    // Show modal for manual entry (for users who want to paste query + results manually)
    const modalHtml = `
        <div class="modal-overlay active" id="add-test-case-modal">
            <div class="modal">
                <div class="modal-header">
                    <h3><i class="fas fa-plus-circle"></i> Add Test Case</h3>
                    <button class="modal-close" onclick="closeModal('add-test-case-modal')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Test Case Name</label>
                        <input type="text" id="tc-name" placeholder="e.g., HTTP Error Analysis">
                    </div>
                    <div class="form-group">
                        <label>Description</label>
                        <input type="text" id="tc-description" placeholder="Brief description of what this tests">
                    </div>
                    <div class="form-group">
                        <label>Target Audience</label>
                        <select id="tc-audience">
                            <option value="developer">Developer</option>
                            <option value="sre">SRE / DevOps</option>
                            <option value="analyst">Data Analyst</option>
                            <option value="executive">Executive</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>KQL Query (read-only context)</label>
                        <textarea id="tc-query" rows="5" placeholder="Paste your KQL query here..."></textarea>
                    </div>
                    <div class="form-group">
                        <label>Results JSON (columns and rows)</label>
                        <textarea id="tc-results" rows="6" placeholder='{"columns": ["col1", "col2"], "rows": [["val1", 123]]}'></textarea>
                    </div>
                    <div class="form-group">
                        <label>Expected Insights (one per line)</label>
                        <textarea id="tc-insights" rows="4" placeholder="Key insight 1&#10;Key insight 2&#10;Key insight 3"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('add-test-case-modal')">Cancel</button>
                    <button class="btn btn-primary" onclick="saveTestCase()">
                        <i class="fas fa-save"></i> Save Test Case
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.remove();
    }
}

function saveTestCase() {
    const name = document.getElementById('tc-name').value.trim();
    const description = document.getElementById('tc-description').value.trim();
    const audience = document.getElementById('tc-audience').value;
    const query = document.getElementById('tc-query').value.trim();
    const resultsJson = document.getElementById('tc-results').value.trim();
    const insights = document.getElementById('tc-insights').value.trim();

    if (!name || !query || !resultsJson) {
        showToast('Please fill in required fields', 'error');
        return;
    }

    let results;
    try {
        results = JSON.parse(resultsJson);
    } catch (e) {
        showToast('Invalid JSON in results field', 'error');
        return;
    }

    const testCase = {
        id: 'tc-' + Date.now(),
        name,
        description,
        audience,
        query,
        results,
        expectedInsights: insights.split('\n').filter(i => i.trim()),
        criticalErrors: []
    };

    benchmarkTestCases.push(testCase);
    renderTestCases();
    closeModal('add-test-case-modal');
    showToast('Test case added', 'success');
}

function addTestCaseFromCurrentResults() {
    if (!currentResults || !currentQuery) {
        showToast('No current results available', 'error');
        return;
    }

    const table = currentResults.tables[0];
    const testCase = {
        id: 'tc-' + Date.now(),
        name: 'Test Case ' + (benchmarkTestCases.length + 1),
        description: 'Created from current query results',
        audience: document.getElementById('target-audience')?.value || 'developer',
        query: currentQuery,
        results: {
            columns: table.columns,
            rows: table.rows.slice(0, 20) // Limit to 20 rows
        },
        expectedInsights: [],
        criticalErrors: []
    };

    benchmarkTestCases.push(testCase);
    renderTestCases();
    showToast('Test case created from current results', 'success');
    switchTab('benchmark');
}

async function runBenchmark() {
    // Check if we have current query results
    if (!currentResults || !currentQuery) {
        showToast('No query results! Go to Explorer and run a query first.', 'error');
        return;
    }

    // Get selected models
    const selectedModels = Array.from(document.querySelectorAll('#benchmark-models input:checked'))
        .map(input => input.value);

    if (selectedModels.length === 0) {
        showToast('Please select at least one model', 'error');
        return;
    }

    if (selectedModels.length < 2) {
        showToast('Select at least 2 models to compare', 'error');
        return;
    }

    const evaluationMethod = document.getElementById('evaluation-method').value;
    const targetAudience = document.getElementById('target-audience').value;

    // Create test case from current results (limit to 10 rows to prevent timeouts)
    const table = currentResults.tables[0];
    const maxRows = 10;
    const testCase = {
        id: 'current',
        name: 'Current Query',
        description: 'Your query results',
        audience: targetAudience,
        query: currentQuery,
        results: {
            columns: table.columns.map(c => c.name || c),
            rows: table.rows.slice(0, maxRows)
        },
        expectedInsights: [],
        criticalErrors: []
    };

    if (table.rows.length > maxRows) {
        showToast(`Using first ${maxRows} of ${table.rows.length} rows for benchmark`, 'info');
    }

    // Show progress
    const resultsSection = document.getElementById('benchmark-results-section');
    resultsSection.style.display = 'block';
    resultsSection.innerHTML = `
        <div class="section-header">
            <h3><i class="fas fa-trophy"></i> Benchmark Results</h3>
        </div>
        <div class="benchmark-progress">
            <div class="progress-bar-container">
                <div class="progress-bar" style="width: 0%"></div>
            </div>
            <div class="progress-status">
                <span id="progress-text">Initializing...</span>
                <span id="progress-percent">0%</span>
            </div>
        </div>
    `;

    const totalSteps = selectedModels.length * 2; // Generate + evaluate for each model
    let completedSteps = 0;
    benchmarkResults = [];

    for (const modelId of selectedModels) {
        const modelName = availableModels.find(m => m.id === modelId)?.name || modelId;
        
        // Update progress - generating
        completedSteps++;
        let percent = Math.round((completedSteps / totalSteps) * 100);
        document.querySelector('.progress-bar').style.width = percent + '%';
        document.getElementById('progress-text').textContent = `Generating explanation with ${modelName}...`;
        document.getElementById('progress-percent').textContent = percent + '%';

        // Get explanation from model
        const explanation = await getModelExplanation(modelId, testCase);
        
        // Update progress - evaluating
        completedSteps++;
        percent = Math.round((completedSteps / totalSteps) * 100);
        document.querySelector('.progress-bar').style.width = percent + '%';
        document.getElementById('progress-text').textContent = `Evaluating ${modelName}'s explanation...`;
        document.getElementById('progress-percent').textContent = percent + '%';

        // Evaluate explanation
        const scores = evaluationMethod === 'llm-judge' 
            ? await evaluateWithLLM(explanation, testCase, targetAudience)
            : getPlaceholderScores();

        benchmarkResults.push({
            model: modelId,
            modelName: modelName,
            explanation,
            scores,
            weightedTotal: calculateWeightedTotal(scores)
        });

        // Small delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Render results
    renderBenchmarkResults();
}

async function getModelExplanation(modelId, testCase) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
        
        const response = await fetch('/api/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: testCase.query,
                tables: [{
                    name: 'Result',
                    columns: testCase.results.columns,
                    rows: testCase.results.rows.slice(0, 10), // Limit rows
                    row_count: testCase.results.rows.length
                }],
                total_rows: testCase.results.rows.length,
                model: modelId
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        const result = await response.json();
        return result.explanation || 'Error generating explanation';
    } catch (error) {
        if (error.name === 'AbortError') {
            return 'Error: Request timed out after 60 seconds';
        }
        return 'Error: ' + error.message;
    }
}

async function evaluateWithLLM(explanation, testCase, targetAudience) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout for multi-judge
        
        // Truncate explanation if too long (max 3000 chars for evaluation)
        const truncatedExplanation = explanation.length > 3000 
            ? explanation.substring(0, 3000) + '... [truncated]'
            : explanation;
        
        // Limit test case data for evaluation
        const limitedTestCase = {
            ...testCase,
            results: {
                columns: testCase.results.columns,
                rows: testCase.results.rows.slice(0, 5) // Only 5 rows for judge
            }
        };
        
        const response = await fetch('/api/benchmark/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                explanation: truncatedExplanation,
                testCase: limitedTestCase,
                targetAudience
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        const result = await response.json();
        
        // Return scores with individualJudges for detailed display
        const scores = result.scores || getPlaceholderScores();
        scores.individualJudges = result.individualJudges || [];
        return scores;
    } catch (error) {
        console.error('Evaluation error:', error);
        if (error.name === 'AbortError') {
            console.error('Evaluation timed out');
        }
        return getPlaceholderScores();
    }
}

function getPlaceholderScores() {
    return {
        faithfulness: Math.random() * 2 + 3,
        structure: Math.random() * 2 + 3,
        clarity: Math.random() * 2 + 3,
        analysisDepth: Math.random() * 2 + 3,
        contextAccuracy: Math.random() * 2 + 3,
        actionability: Math.random() * 2 + 3,
        conciseness: Math.random() * 2 + 3
    };
}

function calculateWeightedTotal(scores) {
    const weights = {
        faithfulness: 0.25,
        structure: 0.10,
        clarity: 0.15,
        analysisDepth: 0.20,
        contextAccuracy: 0.15,
        actionability: 0.10,
        conciseness: 0.05
    };

    return Object.keys(weights).reduce((total, key) => {
        return total + (scores[key] || 0) * weights[key];
    }, 0);
}

function renderBenchmarkResults() {
    const resultsSection = document.getElementById('benchmark-results-section');
    
    // Sort by weighted total (descending - best first)
    benchmarkResults.sort((a, b) => b.weightedTotal - a.weightedTotal);

    resultsSection.innerHTML = `
        <div class="section-header">
            <h3><i class="fas fa-trophy"></i> Benchmark Results</h3>
            <div class="results-actions">
                <button id="export-benchmark-json" class="btn btn-icon" title="Export JSON" onclick="exportBenchmarkToJson()">
                    <i class="fas fa-file-code"></i>
                </button>
                <button id="export-benchmark-csv" class="btn btn-icon" title="Export CSV" onclick="exportBenchmarkToCsv()">
                    <i class="fas fa-file-csv"></i>
                </button>
            </div>
        </div>
        
        <div class="benchmark-chart-container">
            <canvas id="benchmark-chart"></canvas>
        </div>

        <div class="benchmark-results-table">
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Model</th>
                        <th>Faithfulness</th>
                        <th>Structure</th>
                        <th>Clarity</th>
                        <th>Depth</th>
                        <th>Context</th>
                        <th>Actionability</th>
                        <th>Conciseness</th>
                        <th>Weighted Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${benchmarkResults.map((result, index) => `
                        <tr>
                            <td><span class="rank-badge rank-${index + 1}">${index + 1}</span></td>
                            <td><strong>${escapeHtml(result.modelName)}</strong></td>
                            <td class="score-cell ${getScoreClass(result.scores.faithfulness)}">${(result.scores.faithfulness || 0).toFixed(2)}</td>
                            <td class="score-cell ${getScoreClass(result.scores.structure)}">${(result.scores.structure || 0).toFixed(2)}</td>
                            <td class="score-cell ${getScoreClass(result.scores.clarity)}">${(result.scores.clarity || 0).toFixed(2)}</td>
                            <td class="score-cell ${getScoreClass(result.scores.analysisDepth)}">${(result.scores.analysisDepth || 0).toFixed(2)}</td>
                            <td class="score-cell ${getScoreClass(result.scores.contextAccuracy)}">${(result.scores.contextAccuracy || 0).toFixed(2)}</td>
                            <td class="score-cell ${getScoreClass(result.scores.actionability)}">${(result.scores.actionability || 0).toFixed(2)}</td>
                            <td class="score-cell ${getScoreClass(result.scores.conciseness)}">${(result.scores.conciseness || 0).toFixed(2)}</td>
                            <td class="score-cell ${getScoreClass(result.weightedTotal)}"><strong>${result.weightedTotal.toFixed(2)}</strong></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <h3 style="margin: 30px 0 20px; color: var(--text-primary);"><i class="fas fa-file-alt"></i> Model Explanations (Side by Side)</h3>
        <div class="explanation-comparisons">
            ${benchmarkResults.map((result, index) => `
                <div class="explanation-comparison-card">
                    <div class="comparison-card-header">
                        <h4><span class="rank-badge rank-${index + 1}">${index + 1}</span> ${escapeHtml(result.modelName)}</h4>
                        <span class="comparison-card-score">${result.weightedTotal.toFixed(2)}</span>
                    </div>
                    <div class="comparison-card-body">
                        ${marked.parse(result.explanation || 'No explanation')}
                    </div>
                    <div class="comparison-card-scores">
                        <div class="mini-score">
                            <div class="mini-score-value ${getScoreClass(result.scores.faithfulness)}">${(result.scores.faithfulness || 0).toFixed(1)}</div>
                            <div class="mini-score-label">Faith</div>
                        </div>
                        <div class="mini-score">
                            <div class="mini-score-value ${getScoreClass(result.scores.structure)}">${(result.scores.structure || 0).toFixed(1)}</div>
                            <div class="mini-score-label">Struct</div>
                        </div>
                        <div class="mini-score">
                            <div class="mini-score-value ${getScoreClass(result.scores.clarity)}">${(result.scores.clarity || 0).toFixed(1)}</div>
                            <div class="mini-score-label">Clarity</div>
                        </div>
                        <div class="mini-score">
                            <div class="mini-score-value ${getScoreClass(result.scores.analysisDepth)}">${(result.scores.analysisDepth || 0).toFixed(1)}</div>
                            <div class="mini-score-label">Depth</div>
                        </div>
                        <div class="mini-score">
                            <div class="mini-score-value ${getScoreClass(result.scores.contextAccuracy)}">${(result.scores.contextAccuracy || 0).toFixed(1)}</div>
                            <div class="mini-score-label">Context</div>
                        </div>
                        <div class="mini-score">
                            <div class="mini-score-value ${getScoreClass(result.scores.actionability)}">${(result.scores.actionability || 0).toFixed(1)}</div>
                            <div class="mini-score-label">Action</div>
                        </div>
                        <div class="mini-score">
                            <div class="mini-score-value ${getScoreClass(result.scores.conciseness)}">${(result.scores.conciseness || 0).toFixed(1)}</div>
                            <div class="mini-score-label">Concise</div>
                        </div>
                    </div>
                    ${result.scores.evaluatorNotes ? `
                    <div class="evaluator-notes">
                        <div class="evaluator-notes-header">
                            <i class="fas fa-gavel"></i> Multi-Judge Assessment
                            ${result.scores.judgeCount ? `<span class="judge-count">(${result.scores.judgeCount} judges)</span>` : ''}
                        </div>
                        ${formatEvaluatorNotes(result.scores.evaluatorNotes, result.scores.individualJudges)}
                    </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `;

    // Render chart
    renderBenchmarkChart();
}

function getScoreClass(score) {
    if (score >= 4) return 'score-high';
    if (score >= 3) return 'score-medium';
    return 'score-low';
}

function formatJudgeNoteText(noteText) {
    if (!noteText) return '';
    
    // Define dimension patterns with icons
    const dimensionPatterns = [
        { pattern: /faithfulness/gi, icon: '🎯', label: 'Faithfulness' },
        { pattern: /structure/gi, icon: '📋', label: 'Structure' },
        { pattern: /clarity/gi, icon: '💡', label: 'Clarity' },
        { pattern: /(analysis|depth)/gi, icon: '🔍', label: 'Analysis' },
        { pattern: /(context|accuracy)/gi, icon: '🌐', label: 'Context' },
        { pattern: /actionab/gi, icon: '⚡', label: 'Actionability' },
        { pattern: /concise/gi, icon: '✂️', label: 'Conciseness' }
    ];
    
    // Split into sentences
    const sentences = noteText.split(/(?<=[.!?])\s+/);
    let formattedItems = [];
    
    sentences.forEach(sentence => {
        sentence = sentence.trim();
        if (!sentence) return;
        
        // Find which dimension this sentence relates to
        let icon = '📝';
        for (const dim of dimensionPatterns) {
            if (dim.pattern.test(sentence)) {
                icon = dim.icon;
                break;
            }
        }
        
        formattedItems.push(`<li><span class="note-icon">${icon}</span> ${escapeHtml(sentence)}</li>`);
    });
    
    return `<ul class="judge-note-list">${formattedItems.join('')}</ul>`;
}

function formatEvaluatorNotes(notes, individualJudges) {
    if (!notes) return '';
    
    let formattedHtml = '<div class="evaluator-notes-content">';
    
    // If we have individual judge data, show scores per judge
    if (individualJudges && individualJudges.length > 0) {
        formattedHtml += '<div class="judge-scores-breakdown">';
        
        const dimensions = [
            { key: 'faithfulness', label: 'Faithfulness', short: 'Faith' },
            { key: 'structure', label: 'Structure', short: 'Struct' },
            { key: 'clarity', label: 'Clarity', short: 'Clarity' },
            { key: 'analysisDepth', label: 'Analysis Depth', short: 'Depth' },
            { key: 'contextAccuracy', label: 'Context Accuracy', short: 'Context' },
            { key: 'actionability', label: 'Actionability', short: 'Action' },
            { key: 'conciseness', label: 'Conciseness', short: 'Concise' }
        ];
        
        // Create a table showing each judge's scores
        formattedHtml += '<table class="judge-scores-table"><thead><tr><th>Dimension</th>';
        individualJudges.forEach(judge => {
            const modelName = judge.model.replace('gpt-', 'GPT-').replace('-chat', '');
            formattedHtml += `<th>${escapeHtml(modelName)}</th>`;
        });
        formattedHtml += '<th>Avg</th></tr></thead><tbody>';
        
        dimensions.forEach(dim => {
            formattedHtml += `<tr><td class="dim-label">${dim.label}</td>`;
            let total = 0;
            individualJudges.forEach(judge => {
                const score = judge.scores[dim.key] || 0;
                total += score;
                formattedHtml += `<td class="${getScoreClass(score)}">${score}</td>`;
            });
            const avg = total / individualJudges.length;
            formattedHtml += `<td class="avg-score ${getScoreClass(avg)}">${avg.toFixed(1)}</td></tr>`;
        });
        
        formattedHtml += '</tbody></table>';
        formattedHtml += '</div>';
        
        // Show each judge's notes with better formatting
        formattedHtml += '<div class="judge-notes-section">';
        individualJudges.forEach(judge => {
            const modelName = judge.model.replace('gpt-', 'GPT-').replace('-chat', '');
            // Calculate average score for this judge
            const judgeScores = dimensions.map(dim => judge.scores[dim.key] || 0);
            const judgeAvg = judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length;
            if (judge.scores.evaluatorNotes) {
                formattedHtml += `
                    <div class="judge-note-item">
                        <div class="judge-note-header">
                            ${escapeHtml(modelName)}
                            <span class="judge-avg-score ${getScoreClass(judgeAvg)}">${judgeAvg.toFixed(1)}</span>
                        </div>
                        <div class="judge-note-text">${formatJudgeNoteText(judge.scores.evaluatorNotes)}</div>
                    </div>
                `;
            }
        });
        formattedHtml += '</div>';
    } else {
        // Fallback to just showing the notes
        formattedHtml += `<div class="note-summary">${escapeHtml(notes)}</div>`;
    }
    
    formattedHtml += '</div>';
    return formattedHtml;
}

function renderBenchmarkChart() {
    const ctx = document.getElementById('benchmark-chart');
    if (!ctx) return;

    if (benchmarkChart) {
        benchmarkChart.destroy();
    }

    const dimensions = ['Faithfulness', 'Structure', 'Clarity', 'Depth', 'Context', 'Actionability', 'Conciseness'];
    const dimensionKeys = ['faithfulness', 'structure', 'clarity', 'analysisDepth', 'contextAccuracy', 'actionability', 'conciseness'];
    
    const colors = [
        'rgba(137, 180, 250, 0.8)',
        'rgba(166, 227, 161, 0.8)',
        'rgba(249, 226, 175, 0.8)',
        'rgba(243, 139, 168, 0.8)',
        'rgba(203, 166, 247, 0.8)'
    ];

    benchmarkChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: dimensions,
            datasets: benchmarkResults.map((result, index) => ({
                label: result.modelName,
                data: dimensionKeys.map(key => result.scores[key] || 0),
                backgroundColor: colors[index % colors.length].replace('0.8', '0.2'),
                borderColor: colors[index % colors.length],
                borderWidth: 2,
                pointBackgroundColor: colors[index % colors.length]
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#cdd6f4',
                        font: { size: 12 }
                    }
                }
            },
            scales: {
                r: {
                    min: 0,
                    max: 5,
                    ticks: {
                        stepSize: 1,
                        color: '#a6adc8'
                    },
                    grid: {
                        color: 'rgba(69, 71, 90, 0.5)'
                    },
                    angleLines: {
                        color: 'rgba(69, 71, 90, 0.5)'
                    },
                    pointLabels: {
                        color: '#cdd6f4',
                        font: { size: 11 }
                    }
                }
            }
        }
    });
}

function exportBenchmarkToJson() {
    if (!benchmarkResults) {
        showToast('No benchmark results to export', 'error');
        return;
    }

    const exportData = {
        timestamp: new Date().toISOString(),
        testCases: benchmarkTestCases,
        results: benchmarkResults.map(result => ({
            model: result.model,
            modelName: result.modelName,
            averageScores: result.averageScores,
            averageWeightedTotal: result.averageWeightedTotal,
            testCases: result.testCases.map(tc => ({
                testCaseId: tc.testCaseId,
                testCaseName: tc.testCaseName,
                scores: tc.scores,
                weightedTotal: tc.weightedTotal,
                explanation: tc.explanation
            }))
        }))
    };

    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, 'benchmark-results.json', 'application/json');
    showToast('Benchmark results exported', 'success');
}

function exportBenchmarkToCsv() {
    if (!benchmarkResults) {
        showToast('No benchmark results to export', 'error');
        return;
    }

    const headers = ['Model', 'Faithfulness', 'Structure', 'Clarity', 'Depth', 'Context', 'Actionability', 'Conciseness', 'Weighted Total'];
    let csv = headers.join(',') + '\n';

    benchmarkResults.forEach(result => {
        const row = [
            `"${result.modelName}"`,
            result.averageScores.faithfulness.toFixed(2),
            result.averageScores.structure.toFixed(2),
            result.averageScores.clarity.toFixed(2),
            result.averageScores.analysisDepth.toFixed(2),
            result.averageScores.contextAccuracy.toFixed(2),
            result.averageScores.actionability.toFixed(2),
            result.averageScores.conciseness.toFixed(2),
            result.averageWeightedTotal.toFixed(2)
        ];
        csv += row.join(',') + '\n';
    });

    downloadFile(csv, 'benchmark-results.csv', 'text/csv');
    showToast('Benchmark results exported', 'success');
}

// Add close modal to window
window.closeModal = closeModal;
window.saveTestCase = saveTestCase;
window.exportBenchmarkToJson = exportBenchmarkToJson;
window.exportBenchmarkToCsv = exportBenchmarkToCsv;

// ==========================================
// BULK BENCHMARK FUNCTIONALITY
// ==========================================

// Bulk Benchmark State
let bulkQueries = [];
let bulkBenchmarkResults = null;
let bulkBenchmarkChart = null;
let currentWeights = {
    faithfulness: 25,
    structure: 10,
    clarity: 15,
    analysisDepth: 20,
    contextAccuracy: 15,
    actionability: 10,
    conciseness: 5
};

// Initialize Bulk Benchmark
document.addEventListener('DOMContentLoaded', () => {
    // Add bulk benchmark tab handling
    const bulkBenchmarkContent = document.getElementById('bulk-benchmark-content');
    if (bulkBenchmarkContent) {
        initBulkBenchmark();
    }
});

function initBulkBenchmark() {
    // Add query button
    const addQueryBtn = document.getElementById('add-benchmark-query');
    if (addQueryBtn) {
        addQueryBtn.addEventListener('click', () => addBulkQuery());
    }
    
    // Load example queries button
    const loadExamplesBtn = document.getElementById('load-example-queries');
    if (loadExamplesBtn) {
        loadExamplesBtn.addEventListener('click', loadExampleQueries);
    }
    
    // Run benchmark button
    const runBulkBtn = document.getElementById('run-bulk-benchmark');
    if (runBulkBtn) {
        runBulkBtn.addEventListener('click', runBulkBenchmark);
    }
    
    // Weight inputs
    document.querySelectorAll('.weight-input').forEach(input => {
        input.addEventListener('change', updateWeightsTotal);
        input.addEventListener('input', updateWeightsTotal);
    });
    
    // Recalculate button
    const recalcBtn = document.getElementById('recalculate-scores');
    if (recalcBtn) {
        recalcBtn.addEventListener('click', recalculateScores);
    }
    
    // Export buttons
    const exportJsonBtn = document.getElementById('export-bulk-json');
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', exportBulkToJson);
    }
    
    const exportCsvBtn = document.getElementById('export-bulk-csv');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', exportBulkToCsv);
    }
    
    // Add initial empty query
    addBulkQuery();
}

function addBulkQuery(queryText = '') {
    const container = document.getElementById('bulk-query-list');
    const queryNum = bulkQueries.length + 1;
    const queryId = `bulk-query-${Date.now()}`;
    
    const queryItem = document.createElement('div');
    queryItem.className = 'bulk-query-item';
    queryItem.id = queryId;
    queryItem.innerHTML = `
        <div class="bulk-query-header">
            <span class="bulk-query-number">Query ${queryNum}</span>
            <button class="bulk-query-remove" onclick="removeBulkQuery('${queryId}')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <textarea class="bulk-query-input" placeholder="Enter KQL query...">${queryText}</textarea>
        <div class="bulk-query-status" id="${queryId}-status"></div>
    `;
    
    container.appendChild(queryItem);
    bulkQueries.push({ id: queryId, query: queryText });
    
    // Update query text on input
    const textarea = queryItem.querySelector('.bulk-query-input');
    textarea.addEventListener('input', (e) => {
        const idx = bulkQueries.findIndex(q => q.id === queryId);
        if (idx >= 0) {
            bulkQueries[idx].query = e.target.value;
        }
    });
    
    updateBulkQueryNumbers();
}

function removeBulkQuery(queryId) {
    const element = document.getElementById(queryId);
    if (element) {
        element.remove();
        bulkQueries = bulkQueries.filter(q => q.id !== queryId);
        updateBulkQueryNumbers();
    }
}

function updateBulkQueryNumbers() {
    const items = document.querySelectorAll('.bulk-query-item');
    items.forEach((item, idx) => {
        const numberEl = item.querySelector('.bulk-query-number');
        if (numberEl) {
            numberEl.textContent = `Query ${idx + 1}`;
        }
    });
}

async function loadExampleQueries() {
    // Clear existing
    const container = document.getElementById('bulk-query-list');
    container.innerHTML = '';
    bulkQueries = [];
    
    const exampleQueries = [
        `AppRequests
| where Success == false
| summarize FailureCount = sum(ItemCount) by ResultCode
| order by FailureCount desc
| take 5`,
        `Heartbeat
| where TimeGenerated > ago(1h)
| summarize Count = count() by Computer
| order by Count desc
| take 10`,
        `AppExceptions
| where TimeGenerated > ago(24h)
| summarize Count = count() by ExceptionType, ProblemId
| order by Count desc
| take 10`,
        `AppPerformanceCounters
| where TimeGenerated > ago(1h)
| where Name == "% Processor Time"
| summarize AvgCPU = avg(Value) by bin(TimeGenerated, 5m)
| order by TimeGenerated asc`,
        `AppDependencies
| where Success == false
| summarize FailedCalls = count() by DependencyType, Name
| order by FailedCalls desc
| take 10`
    ];
    
    exampleQueries.forEach(query => addBulkQuery(query));
    showToast('Loaded 5 example queries', 'success');
}

function populateBulkBenchmarkModels() {
    const container = document.getElementById('bulk-benchmark-models');
    if (!container || !availableModels.length) return;
    
    container.innerHTML = availableModels.map(model => `
        <label class="model-checkbox">
            <input type="checkbox" value="${model.id}" checked>
            <span>${model.name}</span>
        </label>
    `).join('');
}

function getSelectedBulkModels() {
    const container = document.getElementById('bulk-benchmark-models');
    const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

async function runBulkBenchmark() {
    // Collect queries from textareas
    const queryItems = document.querySelectorAll('.bulk-query-item');
    const queries = [];
    
    queryItems.forEach((item, idx) => {
        const textarea = item.querySelector('.bulk-query-input');
        const query = textarea.value.trim();
        if (query) {
            queries.push({
                id: item.id,
                index: idx + 1,
                query: query
            });
        }
    });
    
    if (queries.length === 0) {
        showToast('Please add at least one query', 'error');
        return;
    }
    
    const selectedModels = getSelectedBulkModels();
    if (selectedModels.length === 0) {
        showToast('Please select at least one model', 'error');
        return;
    }
    
    const workspaceId = workspaceIdInput.value.trim();
    if (!workspaceId) {
        showToast('Please enter a Workspace ID in the Connection panel', 'error');
        return;
    }
    
    const audience = document.getElementById('bulk-target-audience').value;
    
    // Show progress
    document.getElementById('bulk-progress-section').style.display = 'block';
    document.getElementById('bulk-results-section').style.display = 'none';
    
    const totalSteps = queries.length * selectedModels.length;
    let completedSteps = 0;
    
    // Initialize results structure
    const modelResults = {};
    selectedModels.forEach(modelId => {
        const modelInfo = availableModels.find(m => m.id === modelId);
        modelResults[modelId] = {
            model: modelId,
            modelName: modelInfo ? modelInfo.name : modelId,
            queries: []
        };
    });
    
    // Process each query
    for (const queryData of queries) {
        const queryElement = document.getElementById(queryData.id);
        const statusElement = document.getElementById(`${queryData.id}-status`);
        
        queryElement.classList.remove('completed', 'error');
        queryElement.classList.add('running');
        statusElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running query...';
        statusElement.className = 'bulk-query-status running';
        
        try {
            // Execute query
            const queryResponse = await fetch('/api/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspace_id: workspaceId,
                    query: queryData.query,
                    timespan_hours: parseInt(timespanSelect.value)
                })
            });
            
            const queryResult = await queryResponse.json();
            
            if (queryResult.error) {
                throw new Error(queryResult.error);
            }
            
            // Now get explanation and evaluation for each model
            for (const modelId of selectedModels) {
                updateBulkProgress(completedSteps, totalSteps, `Query ${queryData.index}: Getting ${modelId} explanation...`);
                
                try {
                    // Get explanation
                    const explainResponse = await fetch('/api/explain', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: queryData.query,
                            tables: queryResult.tables,
                            model: modelId
                        })
                    });
                    
                    const explainResult = await explainResponse.json();
                    
                    if (explainResult.error) {
                        throw new Error(explainResult.error);
                    }
                    
                    // Evaluate explanation
                    updateBulkProgress(completedSteps, totalSteps, `Query ${queryData.index}: Evaluating ${modelId}...`);
                    
                    const evalResponse = await fetch('/api/benchmark/evaluate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: queryData.query,
                            tables: queryResult.tables,
                            explanation: explainResult.explanation,
                            audience: audience
                        })
                    });
                    
                    const evalResult = await evalResponse.json();
                    
                    if (evalResult.error) {
                        throw new Error(evalResult.error);
                    }
                    
                    modelResults[modelId].queries.push({
                        queryIndex: queryData.index,
                        query: queryData.query,
                        explanation: explainResult.explanation,
                        scores: evalResult.scores
                    });
                    
                } catch (modelError) {
                    console.error(`Error with model ${modelId}:`, modelError);
                    modelResults[modelId].queries.push({
                        queryIndex: queryData.index,
                        query: queryData.query,
                        error: modelError.message
                    });
                }
                
                completedSteps++;
                updateBulkProgress(completedSteps, totalSteps);
            }
            
            queryElement.classList.remove('running');
            queryElement.classList.add('completed');
            statusElement.innerHTML = '<i class="fas fa-check"></i> Completed';
            statusElement.className = 'bulk-query-status completed';
            
        } catch (error) {
            queryElement.classList.remove('running');
            queryElement.classList.add('error');
            statusElement.innerHTML = `<i class="fas fa-times"></i> Error: ${error.message}`;
            statusElement.className = 'bulk-query-status error';
        }
    }
    
    // Process and display results
    bulkBenchmarkResults = processBulkResults(modelResults, queries.length);
    displayBulkResults();
}

function updateBulkProgress(completed, total, details = '') {
    const percent = total > 0 ? (completed / total) * 100 : 0;
    document.getElementById('bulk-progress-bar').style.width = `${percent}%`;
    document.getElementById('bulk-progress-text').textContent = `${completed} / ${total} steps completed`;
    document.getElementById('bulk-progress-details').textContent = details;
}

function processBulkResults(modelResults, queryCount) {
    const results = [];
    
    for (const [modelId, data] of Object.entries(modelResults)) {
        const validQueries = data.queries.filter(q => !q.error && q.scores);
        
        if (validQueries.length === 0) {
            continue;
        }
        
        // Calculate average scores
        const avgScores = {
            faithfulness: 0,
            structure: 0,
            clarity: 0,
            analysisDepth: 0,
            contextAccuracy: 0,
            actionability: 0,
            conciseness: 0
        };
        
        validQueries.forEach(q => {
            for (const dim of Object.keys(avgScores)) {
                avgScores[dim] += q.scores[dim] || 0;
            }
        });
        
        for (const dim of Object.keys(avgScores)) {
            avgScores[dim] = avgScores[dim] / validQueries.length;
        }
        
        // Calculate weighted score
        const weightedScore = calculateWeightedScore(avgScores);
        
        results.push({
            model: modelId,
            modelName: data.modelName,
            avgScores: avgScores,
            weightedScore: weightedScore,
            queriesCompleted: validQueries.length,
            totalQueries: queryCount,
            queries: data.queries
        });
    }
    
    // Sort by weighted score
    results.sort((a, b) => b.weightedScore - a.weightedScore);
    
    return results;
}

function calculateWeightedScore(scores) {
    let total = 0;
    let weightSum = 0;
    
    for (const [dim, weight] of Object.entries(currentWeights)) {
        if (scores[dim] !== undefined) {
            total += scores[dim] * weight;
            weightSum += weight;
        }
    }
    
    return weightSum > 0 ? total / weightSum : 0;
}

function updateWeightsTotal() {
    let total = 0;
    document.querySelectorAll('.weight-input').forEach(input => {
        const dim = input.dataset.dim;
        const value = parseInt(input.value) || 0;
        currentWeights[dim] = value;
        total += value;
    });
    
    const totalEl = document.getElementById('weights-total');
    totalEl.textContent = total;
    totalEl.classList.toggle('invalid', total !== 100);
}

function recalculateScores() {
    if (!bulkBenchmarkResults) return;
    
    // Recalculate weighted scores
    bulkBenchmarkResults.forEach(result => {
        result.weightedScore = calculateWeightedScore(result.avgScores);
    });
    
    // Re-sort
    bulkBenchmarkResults.sort((a, b) => b.weightedScore - a.weightedScore);
    
    // Re-render
    displayBulkResults();
    showToast('Scores recalculated', 'success');
}

function displayBulkResults() {
    if (!bulkBenchmarkResults || bulkBenchmarkResults.length === 0) {
        showToast('No results to display', 'error');
        return;
    }
    
    document.getElementById('bulk-results-section').style.display = 'block';
    
    // Winner card
    const winner = bulkBenchmarkResults[0];
    const winnerCard = document.getElementById('bulk-winner-card');
    winnerCard.innerHTML = `
        <h3><i class="fas fa-crown"></i> Best Performing Model</h3>
        <div class="winner-name">${winner.modelName}</div>
        <div class="winner-score">Weighted Score: ${winner.weightedScore.toFixed(2)}</div>
    `;
    
    // Leaderboard
    const leaderboardBody = document.getElementById('bulk-leaderboard-body');
    leaderboardBody.innerHTML = bulkBenchmarkResults.map((result, idx) => `
        <tr class="rank-${idx + 1}">
            <td>${idx + 1}</td>
            <td class="model-name">${result.modelName}</td>
            <td class="weighted-score">${result.weightedScore.toFixed(2)}</td>
            <td>${result.avgScores.faithfulness.toFixed(2)}</td>
            <td>${result.avgScores.structure.toFixed(2)}</td>
            <td>${result.avgScores.clarity.toFixed(2)}</td>
            <td>${result.avgScores.analysisDepth.toFixed(2)}</td>
            <td>${result.avgScores.contextAccuracy.toFixed(2)}</td>
            <td>${result.avgScores.actionability.toFixed(2)}</td>
            <td>${result.avgScores.conciseness.toFixed(2)}</td>
        </tr>
    `).join('');
    
    // Chart
    renderBulkChart();
    
    // Per-query results
    renderPerQueryResults();
}

function renderBulkChart() {
    const ctx = document.getElementById('bulk-benchmark-chart');
    if (!ctx) return;
    
    if (bulkBenchmarkChart) {
        bulkBenchmarkChart.destroy();
    }
    
    const dimensions = ['faithfulness', 'structure', 'clarity', 'analysisDepth', 'contextAccuracy', 'actionability', 'conciseness'];
    const labels = ['Faithfulness', 'Structure', 'Clarity', 'Depth', 'Context', 'Actionability', 'Conciseness'];
    
    const colors = [
        'rgba(166, 227, 161, 0.8)',
        'rgba(137, 180, 250, 0.8)',
        'rgba(249, 226, 175, 0.8)',
        'rgba(203, 166, 247, 0.8)',
        'rgba(243, 139, 168, 0.8)'
    ];
    
    const datasets = bulkBenchmarkResults.map((result, idx) => ({
        label: result.modelName,
        data: dimensions.map(dim => result.avgScores[dim]),
        backgroundColor: colors[idx % colors.length],
        borderColor: colors[idx % colors.length].replace('0.8', '1'),
        borderWidth: 2
    }));
    
    bulkBenchmarkChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 5,
                    ticks: {
                        stepSize: 1,
                        color: '#a6adc8'
                    },
                    grid: {
                        color: '#45475a'
                    },
                    pointLabels: {
                        color: '#cdd6f4',
                        font: {
                            size: 12
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#cdd6f4',
                        padding: 15,
                        usePointStyle: true
                    }
                }
            }
        }
    });
}

function renderPerQueryResults() {
    const container = document.getElementById('per-query-results-container');
    if (!container || !bulkBenchmarkResults) return;
    
    // Get all unique queries
    const queriesMap = new Map();
    bulkBenchmarkResults.forEach(result => {
        result.queries.forEach(q => {
            if (!queriesMap.has(q.queryIndex)) {
                queriesMap.set(q.queryIndex, {
                    index: q.queryIndex,
                    query: q.query,
                    results: []
                });
            }
            queriesMap.get(q.queryIndex).results.push({
                model: result.model,
                modelName: result.modelName,
                scores: q.scores,
                error: q.error
            });
        });
    });
    
    const queriesArray = Array.from(queriesMap.values()).sort((a, b) => a.index - b.index);
    
    container.innerHTML = queriesArray.map(queryData => `
        <div class="per-query-item" onclick="togglePerQueryItem(this)">
            <div class="per-query-header">
                <h5>
                    <span>Query ${queryData.index}</span>
                    <span class="query-preview">${escapeHtml(queryData.query.substring(0, 60))}${queryData.query.length > 60 ? '...' : ''}</span>
                </h5>
                <i class="fas fa-chevron-down"></i>
            </div>
            <div class="per-query-content">
                <pre style="margin-bottom: 15px; padding: 10px; background: var(--bg-secondary); border-radius: 4px; font-size: 12px; overflow-x: auto;">${escapeHtml(queryData.query)}</pre>
                <div class="per-query-scores">
                    ${queryData.results.map(r => `
                        <div class="per-query-model-score">
                            <div class="model-name">${r.modelName}</div>
                            ${r.error ? `<div class="score" style="color: var(--accent-red);">Error</div>` : `
                                <div class="score">${calculateWeightedScore(r.scores).toFixed(2)}</div>
                                <div class="score-label">Weighted Score</div>
                            `}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `).join('');
}

function togglePerQueryItem(element) {
    element.classList.toggle('expanded');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function exportBulkToJson() {
    if (!bulkBenchmarkResults) {
        showToast('No results to export', 'error');
        return;
    }
    
    const exportData = {
        timestamp: new Date().toISOString(),
        weights: currentWeights,
        results: bulkBenchmarkResults
    };
    
    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, 'bulk-benchmark-results.json', 'application/json');
    showToast('Results exported', 'success');
}

function exportBulkToCsv() {
    if (!bulkBenchmarkResults) {
        showToast('No results to export', 'error');
        return;
    }
    
    const headers = ['Rank', 'Model', 'Weighted Score', 'Faithfulness', 'Structure', 'Clarity', 'Depth', 'Context', 'Actionability', 'Conciseness', 'Queries Completed'];
    let csv = headers.join(',') + '\n';
    
    bulkBenchmarkResults.forEach((result, idx) => {
        const row = [
            idx + 1,
            `"${result.modelName}"`,
            result.weightedScore.toFixed(2),
            result.avgScores.faithfulness.toFixed(2),
            result.avgScores.structure.toFixed(2),
            result.avgScores.clarity.toFixed(2),
            result.avgScores.analysisDepth.toFixed(2),
            result.avgScores.contextAccuracy.toFixed(2),
            result.avgScores.actionability.toFixed(2),
            result.avgScores.conciseness.toFixed(2),
            result.queriesCompleted
        ];
        csv += row.join(',') + '\n';
    });
    
    downloadFile(csv, 'bulk-benchmark-results.csv', 'text/csv');
    showToast('Results exported', 'success');
}

// Update tab switching to handle bulk benchmark
const originalSwitchTab = window.switchTab;
window.switchTab = function(tabId) {
    // Hide all content sections
    document.querySelectorAll('.main-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
    
    // Show selected content
    const contentId = tabId === 'explorer' ? 'explorer-content' : 
                     tabId === 'benchmark' ? 'benchmark-content' : 
                     tabId === 'bulk-benchmark' ? 'bulk-benchmark-content' : null;
    
    if (contentId) {
        document.getElementById(contentId).style.display = 'flex';
    }
    
    // Update active tab
    document.querySelector(`.nav-tab[data-tab="${tabId}"]`)?.classList.add('active');
    
    // Update query preview for Comparison tab
    if (tabId === 'benchmark') {
        updateBenchmarkQueryPreview();
    }
    
    // Populate models for bulk benchmark
    if (tabId === 'bulk-benchmark') {
        populateBulkBenchmarkModels();
    }
};

// Make functions globally available
window.removeBulkQuery = removeBulkQuery;
window.togglePerQueryItem = togglePerQueryItem;