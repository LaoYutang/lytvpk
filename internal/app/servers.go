package app

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"net"
	"strings"
	"time"
)

type PlayerInfo struct {
	Name     string  `json:"name"`
	Score    int32   `json:"score"`
	Duration float32 `json:"duration"`
}

// FetchPlayerList 获取服务器玩家列表
func (a *App) FetchPlayerList(address string) ([]PlayerInfo, error) {
	var lastErr error
	for i := 0; i < 3; i++ {
		players, err := queryA2SPlayers(address)
		if err == nil {
			return players, nil
		}
		lastErr = err
		if i < 2 {
			time.Sleep(time.Duration(200*(i+1)) * time.Millisecond)
		}
	}
	return nil, fmt.Errorf("查询玩家列表失败(重试3次): %v", lastErr)
}

// queryA2SPlayers 使用 UDP 协议查询服务器玩家列表
func queryA2SPlayers(address string) ([]PlayerInfo, error) {
	conn, err := net.DialTimeout("udp", address, 3*time.Second)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(3 * time.Second))

	// A2S_PLAYER Request: FF FF FF FF 55 FF FF FF FF (Initial request with -1 challenge)
	req := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x55, 0xFF, 0xFF, 0xFF, 0xFF}
	_, err = conn.Write(req)
	if err != nil {
		return nil, err
	}

	resp := make([]byte, 65535)
	n, err := conn.Read(resp)
	if err != nil {
		return nil, err
	}
	resp = resp[:n]

	// Parse response header
	if n < 5 || !bytes.Equal(resp[:4], []byte{0xFF, 0xFF, 0xFF, 0xFF}) {
		return nil, fmt.Errorf("invalid response header")
	}

	// Handle Challenge (0x41 'A') - This is expected for A2S_PLAYER
	if resp[4] == 0x41 {
		if n < 9 {
			return nil, fmt.Errorf("invalid challenge response length")
		}
		challenge := resp[5:9]

		// Resend query with challenge
		// Request: FF FF FF FF 55 <Challenge>
		reqWithChallenge := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x55}
		reqWithChallenge = append(reqWithChallenge, challenge...)
		_, err = conn.Write(reqWithChallenge)
		if err != nil {
			return nil, err
		}

		// Read response again
		resp = make([]byte, 65535)
		n, err = conn.Read(resp)
		if err != nil {
			return nil, err
		}
		resp = resp[:n]

		// Check header again
		if n < 5 || !bytes.Equal(resp[:4], []byte{0xFF, 0xFF, 0xFF, 0xFF}) {
			return nil, fmt.Errorf("invalid response header after challenge")
		}
	}

	if resp[4] != 0x44 { // 'D' for Players
		return nil, fmt.Errorf("invalid response type: %x", resp[4])
	}

	reader := bytes.NewBuffer(resp[5:])

	// Number of players
	numPlayers, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}

	var players []PlayerInfo
	for i := 0; i < int(numPlayers); i++ {
		// Index
		_, err := reader.ReadByte()
		if err != nil {
			break
		}

		// Name
		name, err := reader.ReadString(0x00)
		if err != nil {
			break
		}
		name = name[:len(name)-1]

		// Score
		var score int32
		err = binary.Read(reader, binary.LittleEndian, &score)
		if err != nil {
			break
		}

		// Duration
		var duration float32
		err = binary.Read(reader, binary.LittleEndian, &duration)
		if err != nil {
			break
		}

		if name != "" {
			players = append(players, PlayerInfo{
				Name:     name,
				Score:    score,
				Duration: duration,
			})
		}
	}

	return players, nil
}

func queryA2S(address string) (*ServerInfo, error) {
	conn, err := net.DialTimeout("udp", address, 3*time.Second)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(3 * time.Second))

	// TSource Engine Query
	req := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0x54, 0x53, 0x6F, 0x75, 0x72, 0x63, 0x65, 0x20, 0x45, 0x6E, 0x67, 0x69, 0x6E, 0x65, 0x20, 0x51, 0x75, 0x65, 0x72, 0x79, 0x00}
	_, err = conn.Write(req)
	if err != nil {
		return nil, err
	}

	resp := make([]byte, 65535)
	n, err := conn.Read(resp)
	if err != nil {
		return nil, err
	}
	resp = resp[:n]

	// Parse response header
	if n < 5 || !bytes.Equal(resp[:4], []byte{0xFF, 0xFF, 0xFF, 0xFF}) {
		return nil, fmt.Errorf("invalid response header")
	}

	// Handle Challenge (0x41 'A')
	if resp[4] == 0x41 {
		if n < 9 {
			return nil, fmt.Errorf("invalid challenge response length")
		}
		challenge := resp[5:9]

		// Resend query with challenge
		// 注意：这里必须创建一个新的切片，因为 req 是字面量，append 可能会修改底层数组（虽然这里长度固定，但为了安全）
		// 实际上 req 是 []byte{...}，len=25, cap=25。append 会分配新数组。
		// 但是为了绝对安全，我们显式复制
		reqWithChallenge := make([]byte, len(req)+len(challenge))
		copy(reqWithChallenge, req)
		copy(reqWithChallenge[len(req):], challenge)

		_, err = conn.Write(reqWithChallenge)
		if err != nil {
			return nil, err
		}

		// Read response again
		// 必须重置缓冲区，否则旧数据可能残留（虽然我们用了 resp[:n]）
		// 关键：如果服务器返回的数据比缓冲区小，resp[:n] 是对的。
		// 但是如果我们在循环中重用 conn，可能会有问题。这里是单次连接。
		resp = make([]byte, 65535)
		n, err = conn.Read(resp)
		if err != nil {
			return nil, err
		}
		resp = resp[:n]

		// Check header again
		if n < 5 || !bytes.Equal(resp[:4], []byte{0xFF, 0xFF, 0xFF, 0xFF}) {
			return nil, fmt.Errorf("invalid response header after challenge")
		}
	}

	if resp[4] != 0x49 { // 'I'
		return nil, fmt.Errorf("invalid response type: %x", resp[4])
	}

	reader := bytes.NewBuffer(resp[5:])

	readString := func() (string, error) {
		str, readErr := reader.ReadString(0x00)
		if readErr != nil {
			return "", readErr
		}
		return str[:len(str)-1], nil
	}

	// Protocol
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Name
	name, err := readString()
	if err != nil {
		return nil, err
	}

	// Map
	mapName, err := readString()
	if err != nil {
		return nil, err
	}

	// Folder
	folder, err := readString()
	if err != nil {
		return nil, err
	}

	// Game
	_, err = readString()
	if err != nil {
		return nil, err
	}

	// ID
	var id int16
	err = binary.Read(reader, binary.LittleEndian, &id)
	if err != nil {
		return nil, err
	}

	// Players
	players, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// MaxPlayers
	maxPlayers, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Bots
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// ServerType
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Environment
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Visibility
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// VAC
	_, err = reader.ReadByte()
	if err != nil {
		return nil, err
	}

	// Version
	_, err = readString()
	if err != nil {
		return nil, err
	}

	// Extra Data Flag
	edf, err := reader.ReadByte()
	if err == nil {
		if edf&0x80 != 0 {
			// Port
			var port int16
			binary.Read(reader, binary.LittleEndian, &port)
		}
		if edf&0x10 != 0 {
			// SteamID
			var steamID int64
			binary.Read(reader, binary.LittleEndian, &steamID)
		}
		if edf&0x40 != 0 {
			// SourceTV
			var port int16
			binary.Read(reader, binary.LittleEndian, &port)
			readString()
		}
		if edf&0x20 != 0 {
			// Keywords (Tags)
			tags, err := readString()
			if err == nil {
				mode := parseGameMode(tags)
				return &ServerInfo{
					Name:       name,
					Map:        mapName,
					Players:    int(players),
					MaxPlayers: int(maxPlayers),
					GameDir:    folder,
					Mode:       mode,
				}, nil
			}
		}
	}

	// Fallback if no tags found
	return &ServerInfo{
		Name:       name,
		Map:        mapName,
		Players:    int(players),
		MaxPlayers: int(maxPlayers),
		GameDir:    folder,
		Mode:       "未知模式",
	}, nil
}

// FetchServerInfo 获取服务器详细信息
func (a *App) FetchServerInfo(address string) (*ServerInfo, error) {
	// 使用 UDP 直连查询 (A2S_INFO) - 增加重试机制
	var lastErr error
	for i := 0; i < 3; i++ {
		info, err := queryA2S(address)
		if err == nil {
			return info, nil
		}
		lastErr = err
		// 简单的退避策略
		if i < 2 {
			time.Sleep(time.Duration(200*(i+1)) * time.Millisecond)
		}
	}
	return nil, fmt.Errorf("查询服务器失败(重试3次): %v", lastErr)
}

func parseGameMode(gametypeStr string) string {
	gametypeStr = strings.ToLower(gametypeStr)
	tags := strings.Split(gametypeStr, ",")
	var modeTag string
	for _, tag := range tags {
		if strings.HasPrefix(tag, "m:") {
			modeTag = strings.TrimPrefix(tag, "m:")
			break
		}
	}

	// 如果没有找到 m: 标签，尝试使用启发式匹配
	if modeTag == "" {
		if strings.Contains(gametypeStr, "realismversus") {
			return "写实对抗"
		}
		if strings.Contains(gametypeStr, "coop") {
			return "战役"
		}
		if strings.Contains(gametypeStr, "versus") {
			return "对抗"
		}
		if strings.Contains(gametypeStr, "realism") {
			return "写实"
		}
		if strings.Contains(gametypeStr, "survival") {
			return "生存"
		}
		if strings.Contains(gametypeStr, "scavenge") {
			return "清道夫"
		}
		if strings.Contains(gametypeStr, "mutation") {
			return "突变"
		}
		return "未知模式"
	}

	// 映射常见的模式名称
	switch modeTag {
	case "coop":
		return "战役"
	case "versus":
		return "对抗"
	case "realism":
		return "写实"
	case "survival":
		return "生存"
	case "scavenge":
		return "清道夫"
	case "realismversus":
		return "写实对抗"
	case "teamversus":
		return "对抗"
	case "teamscavenge":
		return "清道夫"
	case "dash":
		return "生存跑酷 (Dash)"
	case "holdout":
		return "死守 (Holdout)"
	case "shootzones":
		return "射击禁区 (Shootzones)"
	// 突变模式映射
	case "mutation1":
		return "吉布节 (Gib Fest)"
	case "mutation2":
		return "大流血 (Bleed Out)"
	case "mutation3":
		return "血流不止"
	case "mutation4":
		return "绝境求生"
	case "mutation5":
		return "四剑客 (Four Swordsmen)"
	case "mutation6":
		return "铁人 (Iron Man)"
	case "mutation7":
		return "最后一人 (Last Man on Earth)"
	case "mutation8":
		return "链锯惊魂 (Chainsaw Massacre)"
	case "mutation9":
		return "房间清理 (Room for One)"
	case "mutation10":
		return "猎头者 (Headshot!)"
	case "mutation11":
		return "对抗生存 (Versus Survival)"
	case "mutation12":
		return "写实对抗 (Realism Versus)"
	case "mutation13":
		return "跟随 (Follow the Liter)"
	case "mutation14":
		return "猎人包围 (Hunting Party)"
	case "mutation15":
		return "孤胆枪手 (Lone Gunman)"
	case "mutation16":
		return "特感速递 (Special Delivery)"
	case "mutation17":
		return "流感季节 (Flu Season)"
	case "mutation18":
		return "骑师派对 (Riding My Survivor)"
	case "mutation19":
		return "噩梦 (Nightmare)"
	case "mutation20":
		return "死亡之门"
	default:
		// 如果是社区突变或其他未映射的模式
		if strings.HasPrefix(modeTag, "mutation") {
			return fmt.Sprintf("突变 (%s)", modeTag)
		}
		if strings.HasPrefix(modeTag, "community") {
			return fmt.Sprintf("社区突变 (%s)", modeTag)
		}
		// 首字母大写
		if len(modeTag) > 0 {
			return strings.ToUpper(modeTag[:1]) + modeTag[1:]
		}
		return modeTag
	}
}
