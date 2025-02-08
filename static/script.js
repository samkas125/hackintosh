import { pipeline, env } from 'https://unpkg.com/@xenova/transformers@2.16.0/dist/transformers.min.js';

// Configure environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// DOM Elements
const videoPlayer = document.getElementById('videoPlayer');
const fileInput = document.getElementById('fileInput');
const transcribeButton = document.getElementById('transcribeButton');
const analyzeButton = document.getElementById('analyzeButton');
const transcriptionDiv = document.getElementById('transcription');
const topicResultsDiv = document.getElementById('topicResults');
const statusDiv = document.getElementById('status');
const progress = document.querySelector('.progress');
const modelSelector = document.getElementById('modelSelector');
const modelStatus = document.getElementById('modelStatus');

// State
let whisperPipeline = null;
let transcriptText = '';
let mindmap;

// Initialize Whisper Model
async function initWhisper(modelName) {
    try {
        statusDiv.textContent = 'Loading Whisper model...';
        modelStatus.textContent = 'Loading model...';

        whisperPipeline = await pipeline('automatic-speech-recognition', modelName, {
            progress_callback: (progress) => {
                const percent = Math.round(progress.progress * 100);
                modelStatus.textContent = `Loading model... ${percent}%`;
                statusDiv.textContent = `Loading model... ${percent}%`;
            }
        });

        statusDiv.textContent = 'Model loaded successfully';
        modelStatus.textContent = '✓ Model loaded';
        console.log('Whisper model loaded successfully');
    } catch (error) {
        console.error('Error loading Whisper model:', error);
        showError(`Error loading model: ${error.message}`);
        modelStatus.textContent = '❌ Error loading model';
    }
}

// File Input Handler
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const videoURL = URL.createObjectURL(file);
        videoPlayer.src = videoURL;
        transcribeButton.disabled = !whisperPipeline;
        analyzeButton.disabled = true;
        transcriptionDiv.textContent = '';
        topicResultsDiv.textContent = '';
        transcriptText = '';
        statusDiv.textContent = 'Video loaded. Ready to transcribe.';
        progress.style.width = '0%';
    }
});

// Audio Processing Functions
function convertAudioBuffer(audioBuffer) {
    const audioData = audioBuffer.getChannelData(0);
    const targetSampleRate = 16000;
    const resamplingRatio = targetSampleRate / audioBuffer.sampleRate;
    const resampledLength = Math.floor(audioData.length * resamplingRatio);
    const resampledData = new Float32Array(resampledLength);

    for (let i = 0; i < resampledLength; i++) {
        const originalIndex = Math.floor(i / resamplingRatio);
        resampledData[i] = audioData[originalIndex];
    }

    return resampledData;
}

async function extractAudio(videoFile) {
    try {
        console.log('Starting audio extraction');
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await videoFile.arrayBuffer();
        console.log('Video file loaded into buffer');

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log('Audio decoded successfully');

        return convertAudioBuffer(audioBuffer);
    } catch (error) {
        console.error('Error extracting audio:', error);
        throw new Error(`Failed to extract audio: ${error.message}`);
    }
}

async function transcribeAudio(audioData) {
    try {
        if (!whisperPipeline) {
            throw new Error('Whisper model not loaded');
        }

        statusDiv.textContent = 'Transcribing...';
        console.log('Starting transcription');

        const chunkDuration = 30;
        const samplesPerChunk = chunkDuration * 16000;
        const totalChunks = Math.ceil(audioData.length / samplesPerChunk);

        let fullTranscript = '';

        for (let i = 0; i < totalChunks; i++) {
            const start = i * samplesPerChunk;
            const end = Math.min(start + samplesPerChunk, audioData.length);
            const chunk = audioData.slice(start, end);

            console.log(`Processing chunk ${i + 1}/${totalChunks}`);
            progress.style.width = `${((i + 1) / totalChunks) * 100}%`;

            const result = await whisperPipeline(chunk, {
                chunk_length_s: chunkDuration,
                stride_length_s: 5,
                return_timestamps: true,
                language: 'english',
                task: 'transcribe'
            });

            const timestamp = formatTimestamp(start / 16000);
            fullTranscript += `${timestamp} ${result.text.trim()}\n`;
            transcriptionDiv.textContent = fullTranscript;
            transcriptionDiv.scrollTop = transcriptionDiv.scrollHeight;
        }

        transcriptText = fullTranscript;
        statusDiv.textContent = 'Transcription complete!';
        analyzeButton.disabled = false;
        console.log('Transcription completed successfully');

    } catch (error) {
        console.error('Transcription error:', error);
        throw new Error(`Transcription failed: ${error.message}`);
    }
}

function formatTimestamp(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `[${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

async function analyzeTopics() {
    try {
        statusDiv.textContent = 'Analyzing topics...';
        progress.style.width = '0%';

        const response = await fetch('/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ transcript: transcriptText })
        });

        if (!response.ok) {
            throw new Error('Failed to analyze topics');
        }

        const data = await response.json();
        displayTopicResults(data.segments);
        statusDiv.textContent = 'Topic analysis complete!';
        progress.style.width = '100%';

    } catch (error) {
        console.error('Topic analysis error:', error);
        statusDiv.textContent = `Error: ${error.message}`;
    }
}

function displayTopicResults(segments) {
    // Clear previous results
    topicResultsDiv.innerHTML = '';
    
    // Display topics in the sidebar
    segments.forEach(segment => {
        const topicElement = document.createElement('div');
        topicElement.className = 'topic';
        
        const headerElement = document.createElement('div');
        headerElement.className = 'topic-header';
        headerElement.textContent = segment.topic_name;
        
        const contentElement = document.createElement('div');
        contentElement.className = 'topic-content';
        contentElement.textContent = segment.content.join('\n');
        
        topicElement.appendChild(headerElement);
        topicElement.appendChild(contentElement);
        topicResultsDiv.appendChild(topicElement);
    });

    // Update mindmap and show fullscreen overlay
    mindmap.update(segments);
}

// Event Listeners
transcribeButton.addEventListener('click', async () => {
    try {
        transcribeButton.disabled = true;
        const videoFile = fileInput.files[0];

        if (!videoFile) {
            throw new Error('No video file selected');
        }

        statusDiv.textContent = 'Extracting audio...';
        const audioData = await extractAudio(videoFile);
        await transcribeAudio(audioData);

    } catch (error) {
        console.error('Processing error:', error);
        statusDiv.textContent = `Error: ${error.message}`;
        transcribeButton.disabled = false;
    }
});

analyzeButton.addEventListener('click', analyzeTopics);

modelSelector.addEventListener('change', async (e) => {
    const selectedModel = e.target.value;
    transcribeButton.disabled = true;
    analyzeButton.disabled = true;
    await initWhisper(selectedModel);
    if (fileInput.files.length > 0) {
        transcribeButton.disabled = false;
    }
});

// Initialize with the selected model when the page loads
window.addEventListener('DOMContentLoaded', () => {
    mindmap = new TopicMindmap();
    initWhisper(modelSelector.value).catch(error => {
        console.error('Failed to initialize Whisper:', error);
        statusDiv.textContent = 'Failed to initialize the transcription model';
    });
});

// Replace the TopicMindmap class with this JSMind implementation
class TopicMindmap {
    constructor() {
        this.mindmap = null;
        this.container = 'mindmap';
        this.zoomScale = 1;
        this.isPanning = false;
        this.panX = 0;
        this.panY = 0;
        this.initialize();
        this.setupToolbar();
    }

    initialize() {
        const options = {
            container: this.container,
            theme: 'primary',
            editable: false,
            support_html: true,
            view: {
                hmargin: 300,
                vmargin: 200,
                line_width: 2,
                line_color: '#95a5a6',
                node_spacing: 100
            },
            layout: {
                hspace: 150,
                vspace: 80,
                pspace: 30
            }
        };

        try {
            // Initialize mindmap
            this.mindmap = new jsMind(options);
            const emptyMind = this.createEmptyMindMap();
            this.mindmap.show(emptyMind);
            
            // Ensure container is properly set up
            const container = document.querySelector('.fullscreen-mindmap');
            container.style.transformOrigin = '0 0';
            container.style.position = 'absolute';
            container.style.width = '100%';
            container.style.height = '100%';
            
            // Set up the mindmap wrapper to handle overflow
            const mindmapWrapper = document.getElementById('mindmap');
            mindmapWrapper.style.position = 'absolute';
            mindmapWrapper.style.width = '100%';
            mindmapWrapper.style.height = '100%';
            mindmapWrapper.style.overflow = 'visible';
            
            this.setupPanning();
        } catch (error) {
            console.error('Error initializing mindmap:', error);
        }
    }

    setupPanning() {
        const container = document.querySelector('.fullscreen-mindmap');
        const mindmapWrapper = document.getElementById('mindmap');
        const panButton = document.getElementById('panButton');
        
        panButton.addEventListener('click', () => {
            this.isPanning = !this.isPanning;
            panButton.classList.toggle('active');
            container.style.cursor = this.isPanning ? 'grab' : 'default';
        });

        container.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY * -0.01;
                const newScale = Math.min(Math.max(this.zoomScale + delta, 0.1), 3);
                
                // Get mouse position relative to container
                const rect = container.getBoundingClientRect();
                const x = (e.clientX - rect.left) / this.zoomScale;
                const y = (e.clientY - rect.top) / this.zoomScale;
                
                // Calculate new pan position to zoom towards mouse
                const scale = newScale / this.zoomScale;
                this.panX = x - (x - this.panX) * scale;
                this.panY = y - (y - this.panY) * scale;
                
                this.zoomScale = newScale;
                this.applyTransform();
            }
        });

        container.addEventListener('mousedown', (e) => {
            if (!this.isPanning) return;
            
            container.style.cursor = 'grabbing';
            const startX = e.clientX - this.panX * this.zoomScale;
            const startY = e.clientY - this.panY * this.zoomScale;
            
            const mouseMoveHandler = (e) => {
                if (!this.isPanning) return;
                
                this.panX = (e.clientX - startX) / this.zoomScale;
                this.panY = (e.clientY - startY) / this.zoomScale;
                this.applyTransform();
            };
            
            const mouseUpHandler = () => {
                container.style.cursor = this.isPanning ? 'grab' : 'default';
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
            };
            
            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });
    }

    applyTransform() {
        const container = document.querySelector('.fullscreen-mindmap');
        const matrix = `matrix(${this.zoomScale}, 0, 0, ${this.zoomScale}, ${this.panX * this.zoomScale}, ${this.panY * this.zoomScale})`;
        container.style.transform = matrix;
    }

    resetView() {
        this.zoomScale = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyTransform();
        
        const panButton = document.getElementById('panButton');
        this.isPanning = false;
        panButton.classList.remove('active');
        document.querySelector('.fullscreen-mindmap').style.cursor = 'default';
        
        if (this.mindmap) {
            this.mindmap.resize();
            
            // Center the mindmap after reset
            const container = document.querySelector('.fullscreen-mindmap');
            const mindmapEl = document.getElementById(this.container);
            if (container && mindmapEl) {
                const containerRect = container.getBoundingClientRect();
                const mindmapRect = mindmapEl.getBoundingClientRect();
                
                this.panX = (containerRect.width - mindmapRect.width) / 2;
                this.panY = (containerRect.height - mindmapRect.height) / 2;
                this.applyTransform();
            }
        }
    }

    setupToolbar() {
        const backButton = document.getElementById('backButton');
        const editButton = document.getElementById('editButton');
        const zoomInButton = document.getElementById('zoomInButton');
        const zoomOutButton = document.getElementById('zoomOutButton');
        const resetButton = document.getElementById('resetButton');

        if (backButton) {
            backButton.addEventListener('click', () => {
                document.getElementById('mindmapOverlay').classList.remove('active');
            });
        }

        if (editButton) {
            editButton.addEventListener('click', () => {
                if (this.mindmap) {
                    this.mindmap.enable_edit();
                }
            });
        }

        if (zoomInButton) {
            zoomInButton.addEventListener('click', () => this.zoomIn());
        }

        if (zoomOutButton) {
            zoomOutButton.addEventListener('click', () => this.zoomOut());
        }

        if (resetButton) {
            resetButton.addEventListener('click', () => this.resetView());
        }
    }

    createEmptyMindMap() {
        return {
            meta: {
                name: 'Topics',
                author: 'Video Analyzer',
                version: '1.0'
            },
            format: 'node_tree',
            data: {
                id: 'root',
                topic: 'Video Topics',
                direction: 'center',
                children: []
            }
        };
    }

    zoomIn() {
        this.zoomScale = Math.min(this.zoomScale + 0.1, 2);
        this.applyZoom();
    }

    zoomOut() {
        this.zoomScale = Math.max(this.zoomScale - 0.1, 0.5);
        this.applyZoom();
    }

    resetView() {
        this.zoomScale = 1;
        this.applyZoom();
    }

    applyZoom() {
        const container = document.querySelector('.fullscreen-mindmap');
        if (container) {
            container.style.transform = `scale(${this.zoomScale})`;
            container.style.transformOrigin = 'center center';
        }
    }

    createMindMapData(segments) {
        if (!segments || segments.length === 0) {
            return this.createEmptyMindMap();
        }

        const mind = {
            meta: {
                name: 'Topics',
                author: 'Video Analyzer',
                version: '1.0'
            },
            format: 'node_tree',
            data: {
                id: 'root',
                topic: 'Video Topics',
                direction: 'center',
                expanded: true,     // Root node is expanded
                children: []
            }
        };

        // Group segments by topic
        const topicGroups = new Map();
        segments.forEach(segment => {
            const topicName = segment.topic_name.split(':')[1]?.trim() || segment.topic_name.trim();
            if (!topicGroups.has(topicName)) {
                topicGroups.set(topicName, []);
            }
            topicGroups.get(topicName).push(segment);
        });

        let nodeId = 1;
        topicGroups.forEach((segments, topicName) => {
            const topicNode = {
                id: `topic_${nodeId}`,
                topic: topicName,
                direction: this.getDirection(nodeId, topicGroups.size),
                expanded: false,    // Topic nodes start collapsed
                children: []
            };

            // Add content nodes
            segments.forEach((segment, index) => {
                const contentSnippet = segment.content[0]?.slice(0, 50) + '...' || '';
                topicNode.children.push({
                    id: `content_${nodeId}_${index}`,
                    topic: contentSnippet,
                    direction: topicNode.direction,
                    expanded: false  // Content nodes start collapsed
                });
            });

            mind.data.children.push(topicNode);
            nodeId++;
        });

        return mind;
    }

    getDirection(index, total) {
        const halfTotal = Math.ceil(total / 2);
        if (index <= halfTotal) {
            return 'right';
        } else {
            return 'left';
        }
    }

    update(segments) {
        if (!this.mindmap) {
            console.error('JSMind not initialized');
            return;
        }

        try {
            const mindData = this.createMindMapData(segments);
            this.mindmap.show(mindData);
            
            // Reset pan and zoom when showing new data
            this.resetView();
            
            // Show the fullscreen overlay
            document.getElementById('mindmapOverlay').classList.add('active');
        } catch (error) {
            console.error('Error updating mindmap:', error);
        }
    }
}