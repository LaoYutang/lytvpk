package parser

import (
	"testing"

	"l4d2-manager-next/pkg/valve/vpk"
)

// testArchiveFile 构造一个 VPK 内部条目（路径为 Dir/Base.Ext）
func testArchiveFile(dir, base, ext string) vpk.File {
	return vpk.File{Dir: dir, Base: base, Ext: ext}
}

// classifyVPK 复现 ParseVPKFile 的类型判定与标签检测链路（不含文件系统与元数据部分）
func classifyVPK(files []vpk.File) (string, []string) {
	archive := &vpk.Archive{Files: files}
	result := &VPKFile{Name: "test.vpk", PrimaryTag: "其他"}
	tags := map[string]bool{}

	switch DetermineVPKType(archive) {
	case "人物":
		ProcessCharacterVPK(archive, result, tags)
	case "武器":
		ProcessWeaponVPK(archive, result, tags)
	case "地图":
		result.PrimaryTag = "地图"
	}

	secondary := make([]string, 0, len(tags))
	for tag := range tags {
		secondary = append(secondary, tag)
	}
	return result.PrimaryTag, secondary
}

// 界面/HUD 资源引用角色名属于正常现象，不能作为角色 Mod 的证据（issue #19）
func TestCharacterDetectionIgnoresUIAssets(t *testing.T) {
	cases := []struct {
		name  string
		files []vpk.File
	}{
		{
			name: "HUD界面Mod",
			files: []vpk.File{
				testArchiveFile("materials/vgui/hud", "crouch_survivor", "vtf"),
				testArchiveFile("materials/vgui/hud", "crouch_infected", "vtf"),
				testArchiveFile("materials/vgui/hud", "infected_healthbar_bg_1", "vtf"),
				testArchiveFile("resource/ui/hud", "zombieteamdisplayplayer", "res"),
				testArchiveFile("resource/ui", "spectatorsurvivor", "res"),
			},
		},
		{
			name: "HUD界面Mod附带特效与音效",
			files: []vpk.File{
				testArchiveFile("materials/vgui/hud", "tank_health", "vtf"),
				testArchiveFile("particles", "infected_blood", "pcf"),
				testArchiveFile("sound/ui", "hud_infected_alert", "wav"),
			},
		},
		{
			name: "脚本Mod",
			files: []vpk.File{
				testArchiveFile("scripts/vscripts", "riot_shield", "nut"),
			},
		},
	}

	for _, c := range cases {
		primary, secondary := classifyVPK(c.files)
		if primary != "其他" {
			t.Errorf("%s: 主标签应为其他，实际为 %q", c.name, primary)
		}
		if len(secondary) != 0 {
			t.Errorf("%s: 不应产生子标签，实际为 %v", c.name, secondary)
		}
	}
}

// 真正的角色 Mod 仍要能识别出主标签与子标签
func TestCharacterDetectionKeepsRealCharacterMods(t *testing.T) {
	cases := []struct {
		name      string
		files     []vpk.File
		wantTag   string
		wantPrims string
	}{
		{
			name: "幸存者模型Mod",
			files: []vpk.File{
				testArchiveFile("models/survivors", "survivor_coach", "mdl"),
				testArchiveFile("materials/models/survivors/survivor_coach", "coach_face", "vtf"),
			},
			wantPrims: "人物",
			wantTag:   "Coach",
		},
		{
			name: "幸存者语音包",
			files: []vpk.File{
				testArchiveFile("sound/player/survivor/voice/coach", "positive01", "wav"),
			},
			wantPrims: "人物",
			wantTag:   "Coach",
		},
		{
			name: "特感模型Mod",
			files: []vpk.File{
				testArchiveFile("models/infected", "hulk", "mdl"),
				testArchiveFile("materials/models/infected/hulk", "hulk_body", "vtf"),
			},
			wantPrims: "人物",
			wantTag:   "tank",
		},
		{
			name: "纯材质重制Mod",
			files: []vpk.File{
				testArchiveFile("materials/models/survivors/survivor_gambler", "nick_jacket", "vtf"),
			},
			wantPrims: "人物",
			wantTag:   "Nick",
		},
		{
			name: "武器Mod",
			files: []vpk.File{
				testArchiveFile("models/weapons", "w_rifle_ak47", "mdl"),
				testArchiveFile("materials/weapons", "ak47_slide", "vtf"),
			},
			wantPrims: "武器",
			wantTag:   "AK47",
		},
	}

	for _, c := range cases {
		primary, secondary := classifyVPK(c.files)
		if primary != c.wantPrims {
			t.Errorf("%s: 主标签应为 %q，实际为 %q", c.name, c.wantPrims, primary)
			continue
		}
		found := false
		for _, tag := range secondary {
			if tag == c.wantTag {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: 缺少子标签 %q，实际为 %v", c.name, c.wantTag, secondary)
		}
	}
}

// 命中多个关键词时结果必须稳定：引擎中非普通感染者的模型名同样以 common_male_ 开头
func TestDetectInfectedTypeIsDeterministic(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"models/infected/common_male_ceda.mdl", "uncommon_infected"},
		{"models/infected/common_male_clown.mdl", "uncommon_infected"},
		{"models/infected/common_male_mud.mdl", "uncommon_infected"},
		{"models/infected/common_male_riot.mdl", "uncommon_infected"},
		{"models/infected/common_male_roadcrew.mdl", "uncommon_infected"},
		{"models/infected/common_male_jimmy.mdl", "uncommon_infected"},
		{"models/infected/common_male_fallen_survivor.mdl", "uncommon_infected"},
		{"models/infected/common_male_01.mdl", "common"},
		{"models/infected/hulk.mdl", "tank"},
		{"models/infected/witch.mdl", "witch"},
	}

	for _, c := range cases {
		// 重复执行以覆盖关键词表的遍历顺序
		for i := 0; i < 20; i++ {
			tags := map[string]bool{}
			DetectInfectedType(c.path, tags)
			if len(tags) != 1 || !tags[c.want] {
				t.Fatalf("%s: 期望只有 %q，实际为 %v", c.path, c.want, tags)
			}
		}
	}
}

// 资源路径判定：界面/HUD 目录一律不能作为角色证据
func TestIsCharacterAssetPath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"models/survivors/survivor_coach.mdl", true},
		{"materials/models/infected/common_male_01.vtf", true},
		{"sound/player/survivor/voice/coach/positive01.wav", true},
		{"materials/vgui/hud/crouch_survivor.vtf", false},
		{"materials/vgui/hud/infected_healthbar_bg_1.vtf", false},
		{"resource/ui/spectatorsurvivor.res", false},
		{"scripts/vscripts/riot_shield.nut", false},
		{"particles/infected_blood.pcf", false},
		{"sound/ui/hud_infected_alert.wav", false},
		{"materials/hud/hud_infected_alert.vtf", false},
		{"models/weapons/w_shotgun_spas.mdl", false}, // 不含角色关键词
	}

	for _, c := range cases {
		if got := isCharacterAssetPath(c.path); got != c.want {
			t.Errorf("isCharacterAssetPath(%q) = %v, 期望 %v", c.path, got, c.want)
		}
	}
}
