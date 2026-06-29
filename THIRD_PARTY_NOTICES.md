# Third Party Notices

This project is licensed under GPL-3.0-only. The following third-party code or assets are used by LytVPK and keep their own notices.

## VTF-Editor conversion logic

- Upstream project: https://github.com/Mishcatt/VTF-Editor
- Modified web version referenced during implementation: https://zhrradiant.com/wp-content/tools/VTF-Editor-modified/
- License: GNU General Public License v3.0
- Imported purpose: VTF spray conversion behavior, VTF header/data layout, texture-format choices, mipmap and animation workflow.
- LytVPK changes: rewritten as ES modules for the native tool UI, old HTML/CSS UI removed, DOM-coupled conversion flow separated from rendering, backend export/install integration added.
- Modification date: 2026-06-29

The LytVPK spray tool does not copy the VTF-Editor page interface. It uses a project-native interface and keeps conversion-related logic under GPL-compatible project licensing.

## Bundled font

- File: `frontend/src/assets/fonts/OFL.txt`
- License: SIL Open Font License 1.1
