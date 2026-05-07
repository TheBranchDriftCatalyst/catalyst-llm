package main

import (
	"bufio"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"gopkg.in/yaml.v3"
)

//go:embed index.html
var static embed.FS

// ─── Config from models.yaml ────────────────────────────────────

type ModelsConfig struct {
	Node struct {
		IP   string `yaml:"ip"`
		Chip string `yaml:"chip"`
	} `yaml:"node"`
	Ollama struct {
		Port int `yaml:"port"`
	} `yaml:"ollama"`
	VLLM struct {
		Instances []struct {
			Label   string `yaml:"label"`
			Port    int    `yaml:"port"`
			Model   string `yaml:"model"`
			Launchd string `yaml:"launchd"`
		} `yaml:"instances"`
	} `yaml:"vllm"`
}

var config ModelsConfig

func loadConfig() {
	exe, _ := os.Executable()
	repoDir := filepath.Dir(filepath.Dir(exe))
	configPath := filepath.Join(repoDir, "models.yaml")

	data, err := os.ReadFile(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not read %s: %v\n", configPath, err)
		// Fallback defaults
		config.Ollama.Port = 11434
		return
	}
	if err := yaml.Unmarshal(data, &config); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: could not parse models.yaml: %v\n", err)
		config.Ollama.Port = 11434
	}
	fmt.Printf("Loaded %d vLLM instances from models.yaml\n", len(config.VLLM.Instances))
}

// ─── Types ───────────────────────────────────────────────────────

type Stats struct {
	Memory        MemoryStats      `json:"memory"`
	CPU           CPUStats         `json:"cpu"`
	GPU           GPUStats         `json:"gpu"`
	Uptime        string           `json:"uptime"`
	RunningModels []RunningModel   `json:"running_models"`
	LogLines      map[string]int   `json:"log_lines"`
	Services      map[string]bool  `json:"services"`
	Pids          map[string]int   `json:"pids"`
	ModelCount    int              `json:"model_count"`
	Timestamp     int64            `json:"timestamp"`
}

type MemoryStats struct {
	TotalGB     float64 `json:"total_gb"`
	UsedGB      float64 `json:"used_gb"`
	AvailableGB float64 `json:"available_gb"`
	Percent     float64 `json:"percent"`
}

type CPUStats struct {
	Cores  int     `json:"cores"`
	Load1  float64 `json:"load_1m"`
	Load5  float64 `json:"load_5m"`
	Load15 float64 `json:"load_15m"`
}

type GPUStats struct {
	Name  string `json:"name"`
	Cores string `json:"cores"`
}

type RunningModel struct {
	Name    string  `json:"name"`
	SizeGB  float64 `json:"size_gb"`
	VRAMGB  float64 `json:"vram_gb"`
	Expires string  `json:"expires"`
}

// ─── WebSocket Hub ───────────────────────────────────────────────

type hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]bool
}

var wsHub = &hub{clients: make(map[*websocket.Conn]bool)}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (h *hub) add(ws *websocket.Conn) {
	h.mu.Lock()
	h.clients[ws] = true
	h.mu.Unlock()
}

func (h *hub) remove(ws *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, ws)
	h.mu.Unlock()
}

func (h *hub) broadcast(data []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ws := range h.clients {
		if err := ws.WriteMessage(websocket.TextMessage, data); err != nil {
			ws.Close()
			delete(h.clients, ws)
		}
	}
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	wsHub.add(ws)
	defer wsHub.remove(ws)
	defer ws.Close()

	if data, err := json.Marshal(collectStats()); err == nil {
		ws.WriteMessage(websocket.TextMessage, data)
	}

	for {
		if _, _, err := ws.ReadMessage(); err != nil {
			break
		}
	}
}

// ─── Stats Collection ────────────────────────────────────────────

func sysctl(key string) string {
	out, err := exec.Command("sysctl", "-n", key).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func getMemory() MemoryStats {
	var m MemoryStats
	if total, err := strconv.ParseInt(sysctl("hw.memsize"), 10, 64); err == nil {
		m.TotalGB = float64(total) / 1e9
	}

	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return m
	}

	pageSize := int64(16384)
	pages := map[string]int64{}
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(strings.ToLower(line), "page size") {
			re := regexp.MustCompile(`(\d+)`)
			if match := re.FindString(line); match != "" {
				if ps, err := strconv.ParseInt(match, 10, 64); err == nil {
					pageSize = ps
				}
			}
			continue
		}
		if idx := strings.Index(line, ":"); idx > 0 {
			key := strings.TrimSpace(strings.ToLower(line[:idx]))
			val := strings.TrimSpace(strings.TrimRight(line[idx+1:], "."))
			if n, err := strconv.ParseInt(val, 10, 64); err == nil {
				pages[key] = n
			}
		}
	}

	active := pages["pages active"]
	wired := pages["pages wired down"]
	compressed := pages["pages occupied by compressor"]
	free := pages["pages free"]
	inactive := pages["pages inactive"]
	speculative := pages["pages speculative"]

	usedBytes := float64((active + wired + compressed) * pageSize)
	availBytes := float64((free + inactive + speculative) * pageSize)

	m.UsedGB = usedBytes / 1e9
	m.AvailableGB = availBytes / 1e9
	if m.TotalGB > 0 {
		m.Percent = usedBytes / (m.TotalGB * 1e9) * 100
	}
	return m
}

func getCPU() CPUStats {
	var c CPUStats
	if cores, err := strconv.Atoi(sysctl("hw.ncpu")); err == nil {
		c.Cores = cores
	}
	loadStr := strings.Trim(sysctl("vm.loadavg"), "{ }")
	parts := strings.Fields(loadStr)
	if len(parts) >= 3 {
		c.Load1, _ = strconv.ParseFloat(parts[0], 64)
		c.Load5, _ = strconv.ParseFloat(parts[1], 64)
		c.Load15, _ = strconv.ParseFloat(parts[2], 64)
	}
	return c
}

var gpuCache GPUStats
var gpuOnce sync.Once

func getGPU() GPUStats {
	gpuOnce.Do(func() {
		out, err := exec.Command("system_profiler", "SPDisplaysDataType").Output()
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if after, ok := strings.CutPrefix(line, "Chipset Model:"); ok {
				gpuCache.Name = strings.TrimSpace(after)
			}
			if after, ok := strings.CutPrefix(line, "Total Number of Cores:"); ok {
				gpuCache.Cores = strings.TrimSpace(after)
			}
		}
	})
	return gpuCache
}

func getUptime() string {
	re := regexp.MustCompile(`sec\s*=\s*(\d+)`)
	match := re.FindStringSubmatch(sysctl("kern.boottime"))
	if len(match) < 2 {
		return "?"
	}
	bootSec, _ := strconv.ParseInt(match[1], 10, 64)
	uptime := time.Now().Unix() - bootSec
	days := uptime / 86400
	hours := (uptime % 86400) / 3600
	if days > 0 {
		return fmt.Sprintf("%dd %dh", days, hours)
	}
	return fmt.Sprintf("%dh", hours)
}

func getRunningModels() []RunningModel {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://localhost:%d/api/ps", config.Ollama.Port))
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data struct {
		Models []struct {
			Name      string `json:"name"`
			Size      int64  `json:"size"`
			SizeVRAM  int64  `json:"size_vram"`
			ExpiresAt string `json:"expires_at"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil
	}

	models := make([]RunningModel, len(data.Models))
	for i, m := range data.Models {
		models[i] = RunningModel{
			Name:    m.Name,
			SizeGB:  float64(m.Size) / 1e9,
			VRAMGB:  float64(m.SizeVRAM) / 1e9,
			Expires: m.ExpiresAt,
		}
	}
	return models
}

func getModelCount() int {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://localhost:%d/api/tags", config.Ollama.Port))
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var data struct {
		Models []json.RawMessage `json:"models"`
	}
	json.Unmarshal(body, &data)
	return len(data.Models)
}

func checkServiceUp(url string) bool {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 500
}

func countLogLines(path string) int {
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()
	count := 0
	scanner := bufio.NewScanner(f)
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		count++
	}
	return count
}

func collectStats() Stats {
	ollamaPort := config.Ollama.Port
	if ollamaPort == 0 {
		ollamaPort = 11434
	}

	services := map[string]bool{
		"ollama":  checkServiceUp(fmt.Sprintf("http://localhost:%d/", ollamaPort)),
		"webui":   checkServiceUp("http://localhost:3000/health"),
		"whisper": checkServiceUp("http://localhost:8787/"),
	}
	logLines := map[string]int{
		"ollama":  countLogLines("/tmp/ollama.log"),
		"webui":   countLogLines("/tmp/open-webui.log"),
		"whisper": countLogLines("/tmp/whisper-api.log"),
	}

	// Add vLLM instances from config
	for _, inst := range config.VLLM.Instances {
		services[inst.Label] = checkServiceUp(fmt.Sprintf("http://localhost:%d/v1/models", inst.Port))
		logPath := fmt.Sprintf("/tmp/vllm-%s.log", inst.Label)
		logLines[inst.Label] = countLogLines(logPath)
	}

	return Stats{
		Memory:        getMemory(),
		CPU:           getCPU(),
		GPU:           getGPU(),
		Uptime:        getUptime(),
		RunningModels: getRunningModels(),
		LogLines:      logLines,
		Services:      services,
		Pids:          getPids(),
		ModelCount:    getModelCount(),
		Timestamp:     time.Now().Unix(),
	}
}

// ─── Log Streaming ───────────────────────────────────────────────

func buildLogFiles() map[string][]string {
	lf := map[string][]string{
		"ollama":  {"/tmp/ollama.log", "/tmp/ollama.err"},
		"webui":   {"/tmp/open-webui.log", "/tmp/open-webui.err"},
		"whisper": {"/tmp/whisper-api.log", "/tmp/whisper-api.err"},
	}
	for _, inst := range config.VLLM.Instances {
		prefix := fmt.Sprintf("/tmp/vllm-%s", inst.Label)
		lf[inst.Label] = []string{prefix + ".log", prefix + ".err"}
	}
	return lf
}

var logFiles map[string][]string

type logLine struct {
	Source string `json:"source"`
	Line   string `json:"line"`
}

func tailLastN(path string, n int) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines
}

func tailFollow(path, source string, ch chan<- logLine, done <-chan struct{}) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	f.Seek(0, io.SeekEnd)

	reader := bufio.NewReader(f)
	var partial string

	for {
		select {
		case <-done:
			return
		default:
		}

		line, err := reader.ReadString('\n')
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			if pos, _ := f.Seek(0, io.SeekCurrent); pos > fileSize(path) {
				f.Seek(0, io.SeekStart)
				reader.Reset(f)
			}
			if len(line) > 0 {
				partial += line
			}
			continue
		}

		full := partial + strings.TrimRight(line, "\n")
		partial = ""
		if full != "" {
			ch <- logLine{Source: source, Line: full}
		}
	}
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func wsLogsHandler(w http.ResponseWriter, r *http.Request) {
	svc := r.URL.Query().Get("service")
	files, ok := logFiles[svc]
	if !ok {
		http.Error(w, "unknown service", 400)
		return
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	done := make(chan struct{})
	lines := make(chan logLine, 100)

	var backlog []logLine
	for _, path := range files {
		source := "stdout"
		if strings.HasSuffix(path, ".err") {
			source = "stderr"
		}
		for _, l := range tailLastN(path, 200) {
			backlog = append(backlog, logLine{Source: source, Line: l})
		}
	}
	if len(backlog) > 300 {
		backlog = backlog[len(backlog)-300:]
	}
	if data, err := json.Marshal(backlog); err == nil {
		ws.WriteMessage(websocket.TextMessage, data)
	}

	for _, path := range files {
		source := "stdout"
		if strings.HasSuffix(path, ".err") {
			source = "stderr"
		}
		go tailFollow(path, source, lines, done)
	}

	go func() {
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				close(done)
				return
			}
		}
	}()

	for {
		select {
		case <-done:
			return
		case entry := <-lines:
			data, _ := json.Marshal(entry)
			if err := ws.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		}
	}
}

// ─── Service Management ─────────────────────────────────────────

// Map dashboard labels to launchd service names
func buildServiceMap() map[string]string {
	m := map[string]string{
		"ollama":  "com.ollama.server",
		"webui":   "com.open-webui.server",
		"whisper": "com.whisper-api.server",
	}
	for _, inst := range config.VLLM.Instances {
		m[inst.Label] = inst.Launchd
	}
	return m
}

var serviceMap map[string]string

func getLaunchdPID(label string) int {
	out, err := exec.Command("launchctl", "list").Output()
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, label) {
			fields := strings.Fields(line)
			if len(fields) >= 1 {
				if pid, err := strconv.Atoi(fields[0]); err == nil {
					return pid
				}
			}
		}
	}
	return 0
}

func getPids() map[string]int {
	pids := map[string]int{}
	for label, svc := range serviceMap {
		if pid := getLaunchdPID(svc); pid > 0 {
			pids[label] = pid
		}
	}
	return pids
}

func restartHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}

	var req struct {
		Service string `json:"service"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}

	svc, ok := serviceMap[req.Service]
	if !ok {
		http.Error(w, "unknown service: "+req.Service, 404)
		return
	}

	// Stop, wait, start
	exec.Command("launchctl", "stop", svc).Run()
	time.Sleep(2 * time.Second)
	err := exec.Command("launchctl", "start", svc).Run()

	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		json.NewEncoder(w).Encode(map[string]string{"status": "error", "error": err.Error()})
	} else {
		pid := getLaunchdPID(svc)
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "service": req.Service, "pid": pid})
	}
}

func toggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}

	var req struct {
		Service string `json:"service"`
		Action  string `json:"action"` // "stop" or "start"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", 400)
		return
	}

	svc, ok := serviceMap[req.Service]
	if !ok {
		http.Error(w, "unknown service: "+req.Service, 404)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	home, _ := os.UserHomeDir()
	plistPath := filepath.Join(home, "Library", "LaunchAgents", svc+".plist")
	uid := fmt.Sprintf("gui/%d", os.Getuid())

	var err error
	if req.Action == "stop" {
		// bootout fully unloads so KeepAlive can't restart it
		err = exec.Command("launchctl", "bootout", uid+"/"+svc).Run()
	} else if req.Action == "start" {
		// bootstrap re-loads the plist, then kickstart ensures it runs
		err = exec.Command("launchctl", "bootstrap", uid, plistPath).Run()
		if err == nil {
			exec.Command("launchctl", "kickstart", uid+"/"+svc).Run()
		}
		time.Sleep(2 * time.Second)
	} else {
		http.Error(w, "action must be 'stop' or 'start'", 400)
		return
	}

	if err != nil {
		json.NewEncoder(w).Encode(map[string]string{"status": "error", "error": err.Error()})
	} else {
		pid := getLaunchdPID(svc)
		json.NewEncoder(w).Encode(map[string]any{"status": "ok", "service": req.Service, "action": req.Action, "pid": pid})
	}
}

// ─── Config API ─────────────────────────────────────────────────

type VLLMInstanceInfo struct {
	Label       string `json:"label"`
	Port        int    `json:"port"`
	Model       string `json:"model"`
	Description string `json:"description"`
}

func configHandler(w http.ResponseWriter, r *http.Request) {
	exe, _ := os.Executable()
	repoDir := filepath.Dir(filepath.Dir(exe))
	data, err := os.ReadFile(filepath.Join(repoDir, "models.yaml"))
	if err != nil {
		http.Error(w, "models.yaml not found", 500)
		return
	}

	var full struct {
		Node struct {
			IP   string `yaml:"ip" json:"ip"`
			Chip string `yaml:"chip" json:"chip"`
		} `yaml:"node" json:"node"`
		VLLM struct {
			Instances []struct {
				Label       string   `yaml:"label" json:"label"`
				Port        int      `yaml:"port" json:"port"`
				Model       string   `yaml:"model" json:"model"`
				Description string   `yaml:"description" json:"description"`
				Tags        []string `yaml:"tags" json:"tags"`
			} `yaml:"instances" json:"instances"`
		} `yaml:"vllm" json:"vllm"`
	}
	yaml.Unmarshal(data, &full)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(full)
}

// ─── Broadcast Loop ──────────────────────────────────────────────

func broadcastLoop() {
	for {
		time.Sleep(2 * time.Second)
		wsHub.mu.Lock()
		n := len(wsHub.clients)
		wsHub.mu.Unlock()
		if n == 0 {
			continue
		}

		stats := collectStats()
		data, err := json.Marshal(stats)
		if err != nil {
			continue
		}
		wsHub.broadcast(data)
	}
}

// ─── Main ────────────────────────────────────────────────────────

func main() {
	loadConfig()
	logFiles = buildLogFiles()
	serviceMap = buildServiceMap()

	go broadcastLoop()

	http.HandleFunc("/ws", wsHandler)
	http.HandleFunc("/ws/logs", wsLogsHandler)
	http.HandleFunc("/api/config", configHandler)
	http.HandleFunc("/api/restart", restartHandler)
	http.HandleFunc("/api/toggle", toggleHandler)
	http.Handle("/", http.FileServer(http.FS(static)))

	fmt.Println("Mac Node Dashboard on :9090 (WebSocket at /ws)")
	if err := http.ListenAndServe(":9090", nil); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
