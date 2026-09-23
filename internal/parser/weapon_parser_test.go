package parser

import "testing"

// 同一路径可能命中多个关键词（如 w_shotgun_spas 同时含 w_shotgun 与 spas），
// 结果必须稳定且落在更具体的型号上
func TestDetectWeaponTypeIsDeterministic(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"models/weapons/w_shotgun.mdl", "木喷"},
		{"models/weapons/w_shotgun_chrome.mdl", "铁喷"},
		{"models/weapons/w_shotgun_spas.mdl", "二代连喷"},
		{"models/weapons/w_autoshotgun.mdl", "一代连喷"},
		{"sound/weapons/auto_shotgun_spas/gunfire/shotgun_fire_1.wav", "二代连喷"},
		{"models/weapons/w_desert_eagle.mdl", "马格南"},
		{"models/weapons/w_magnum.mdl", "马格南"},
		{"models/weapons/w_rifle_desert.mdl", "三连发"},
		{"models/weapons/w_rifle_ak47.mdl", "AK47"},
		{"models/weapons/w_rifle_m16a2.mdl", "M16"},
		{"models/weapons/w_sniper_military.mdl", "军狙"},
		{"models/weapons/w_hunting_rifle.mdl", "猎枪"},
		{"models/weapons/w_smg_silenced.mdl", "消音"},
		{"models/weapons/melee/w_machete.mdl", "砍刀"},
	}

	for _, c := range cases {
		// 重复执行以覆盖关键词表的遍历顺序
		for i := 0; i < 20; i++ {
			tags := map[string]bool{}
			DetectWeaponType(c.path, tags)
			if len(tags) != 1 || !tags[c.want] {
				t.Fatalf("%s: 期望只有 %q，实际为 %v", c.path, c.want, tags)
			}
		}
	}
}
