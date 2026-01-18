/**
 * Azure KQL Explorer - Frontend Application
 */

// State
let currentResults = null;
let currentQuery = null;
let selectedModel = 'gpt-4';

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
async function loadExample(category, index) {
    try {
        const response = await fetch('/api/examples');
        const examples = await response.json();
        
        const query = examples[category].queries[index].query;
        kqlQueryTextarea.value = query;
        updateLineNumbers();
        showToast('Example query loaded', 'success');
    } catch (error) {
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
window.loadExample = loadExample;
