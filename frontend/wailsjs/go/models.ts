export namespace app {
	
	export class SavedDirectory {
	    path: string;
	    lastUsed: string;
	
	    static createFrom(source: any = {}) {
	        return new SavedDirectory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.lastUsed = source["lastUsed"];
	    }
	}
	export class RotationConfig {
	    enableCharacters: boolean;
	    enableWeapons: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RotationConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enableCharacters = source["enableCharacters"];
	        this.enableWeapons = source["enableWeapons"];
	    }
	}
	export class ConfigFile {
	    modRotationConfig: RotationConfig;
	    workshopPreferredIP?: boolean;
	    workshopFixedIP?: string;
	    workshopMetaEnabled?: boolean;
	    workshopUpdateCheckEnabled?: boolean;
	    workshopBrowserTarget?: string;
	    workshopTranslateProvider?: string;
	    defaultDirectory: string;
	    savedDirectories: SavedDirectory[];
	    lastActiveDirectory: string;
	    displayMode: string;
	    filterLayoutMode: string;
	    boxSelectionEnabled?: boolean;
	    ctrlClickSelectionEnabled?: boolean;
	    theme: string;
	    ignoredVersion: string;
	    lastUpdateCheckTime: string;
	    migrationVersion: number;
	
	    static createFrom(source: any = {}) {
	        return new ConfigFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.modRotationConfig = this.convertValues(source["modRotationConfig"], RotationConfig);
	        this.workshopPreferredIP = source["workshopPreferredIP"];
	        this.workshopFixedIP = source["workshopFixedIP"];
	        this.workshopMetaEnabled = source["workshopMetaEnabled"];
	        this.workshopUpdateCheckEnabled = source["workshopUpdateCheckEnabled"];
	        this.workshopBrowserTarget = source["workshopBrowserTarget"];
	        this.workshopTranslateProvider = source["workshopTranslateProvider"];
	        this.defaultDirectory = source["defaultDirectory"];
	        this.savedDirectories = this.convertValues(source["savedDirectories"], SavedDirectory);
	        this.lastActiveDirectory = source["lastActiveDirectory"];
	        this.displayMode = source["displayMode"];
	        this.filterLayoutMode = source["filterLayoutMode"];
	        this.boxSelectionEnabled = source["boxSelectionEnabled"];
	        this.ctrlClickSelectionEnabled = source["ctrlClickSelectionEnabled"];
	        this.theme = source["theme"];
	        this.ignoredVersion = source["ignoredVersion"];
	        this.lastUpdateCheckTime = source["lastUpdateCheckTime"];
	        this.migrationVersion = source["migrationVersion"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ConflictVPKFile {
	    name: string;
	    path: string;
	    title: string;
	    location: string;
	
	    static createFrom(source: any = {}) {
	        return new ConflictVPKFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.title = source["title"];
	        this.location = source["location"];
	    }
	}
	export class ConflictGroup {
	    vpk_files: ConflictVPKFile[];
	    files: string[];
	    file_count: number;
	    files_truncated: boolean;
	    severity: string;
	
	    static createFrom(source: any = {}) {
	        return new ConflictGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.vpk_files = this.convertValues(source["vpk_files"], ConflictVPKFile);
	        this.files = source["files"];
	        this.file_count = source["file_count"];
	        this.files_truncated = source["files_truncated"];
	        this.severity = source["severity"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ConflictResult {
	    total_conflicts: number;
	    conflict_groups: ConflictGroup[];
	
	    static createFrom(source: any = {}) {
	        return new ConflictResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total_conflicts = source["total_conflicts"];
	        this.conflict_groups = this.convertValues(source["conflict_groups"], ConflictGroup);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class DownloadTask {
	    id: string;
	    workshop_id: string;
	    title: string;
	    filename: string;
	    preview_url: string;
	    file_url: string;
	    use_optimized_ip: boolean;
	    status: string;
	    progress: number;
	    total_size: number;
	    downloaded_size: number;
	    speed: string;
	    error: string;
	    description: string;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new DownloadTask(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.workshop_id = source["workshop_id"];
	        this.title = source["title"];
	        this.filename = source["filename"];
	        this.preview_url = source["preview_url"];
	        this.file_url = source["file_url"];
	        this.use_optimized_ip = source["use_optimized_ip"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.total_size = source["total_size"];
	        this.downloaded_size = source["downloaded_size"];
	        this.speed = source["speed"];
	        this.error = source["error"];
	        this.description = source["description"];
	        this.created_at = source["created_at"];
	    }
	}
	export class LocalStorageMigrationPayload {
	    config: string;
	    theme: string;
	    lastUpdateCheckTime: string;
	    servers: string;
	    recentServers: string;
	    watchLaterItems: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalStorageMigrationPayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.config = source["config"];
	        this.theme = source["theme"];
	        this.lastUpdateCheckTime = source["lastUpdateCheckTime"];
	        this.servers = source["servers"];
	        this.recentServers = source["recentServers"];
	        this.watchLaterItems = source["watchLaterItems"];
	    }
	}
	export class MirrorWithLatency {
	    url: string;
	    latency: number;
	
	    static createFrom(source: any = {}) {
	        return new MirrorWithLatency(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.latency = source["latency"];
	    }
	}
	export class ProgressInfo {
	    current: number;
	    total: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new ProgressInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = source["current"];
	        this.total = source["total"];
	        this.message = source["message"];
	    }
	}
	export class ModelStatsScanState {
	    status: string;
	    running: boolean;
	    scanId?: string;
	    rootDir?: string;
	    progress: ProgressInfo;
	
	    static createFrom(source: any = {}) {
	        return new ModelStatsScanState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.running = source["running"];
	        this.scanId = source["scanId"];
	        this.rootDir = source["rootDir"];
	        this.progress = this.convertValues(source["progress"], ProgressInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MoveResult {
	    successCount: number;
	    failCount: number;
	    errors: string[];
	
	    static createFrom(source: any = {}) {
	        return new MoveResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.successCount = source["successCount"];
	        this.failCount = source["failCount"];
	        this.errors = source["errors"];
	    }
	}
	export class PanelChapter {
	    code: string;
	    title: string;
	    modes: string[];
	
	    static createFrom(source: any = {}) {
	        return new PanelChapter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.title = source["title"];
	        this.modes = source["modes"];
	    }
	}
	export class PanelCampaign {
	    title: string;
	    chapters: PanelChapter[];
	    vpkName: string;
	
	    static createFrom(source: any = {}) {
	        return new PanelCampaign(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.chapters = this.convertValues(source["chapters"], PanelChapter);
	        this.vpkName = source["vpkName"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PanelMapUploadTask {
	    id: string;
	    server_id: string;
	    server_name: string;
	    file_path: string;
	    filename: string;
	    upload_id: string;
	    status: string;
	    progress: number;
	    total_chunks: number;
	    uploaded_chunks: number[];
	    total_size: number;
	    uploaded_size: number;
	    speed: string;
	    error: string;
	    created_at: string;
	
	    static createFrom(source: any = {}) {
	        return new PanelMapUploadTask(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.server_id = source["server_id"];
	        this.server_name = source["server_name"];
	        this.file_path = source["file_path"];
	        this.filename = source["filename"];
	        this.upload_id = source["upload_id"];
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.total_chunks = source["total_chunks"];
	        this.uploaded_chunks = source["uploaded_chunks"];
	        this.total_size = source["total_size"];
	        this.uploaded_size = source["uploaded_size"];
	        this.speed = source["speed"];
	        this.error = source["error"];
	        this.created_at = source["created_at"];
	    }
	}
	export class PanelUser {
	    name: string;
	    id: number;
	    steamid: string;
	    ip: string;
	    location: string;
	    status: string;
	    delay: number;
	    loss: number;
	    duration: string;
	    linkrate: number;
	
	    static createFrom(source: any = {}) {
	        return new PanelUser(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.id = source["id"];
	        this.steamid = source["steamid"];
	        this.ip = source["ip"];
	        this.location = source["location"];
	        this.status = source["status"];
	        this.delay = source["delay"];
	        this.loss = source["loss"];
	        this.duration = source["duration"];
	        this.linkrate = source["linkrate"];
	    }
	}
	export class PanelServerStatus {
	    users: PanelUser[];
	    players: string;
	    map: string;
	    hostname: string;
	    name: string;
	    serverName: string;
	    difficulty: string;
	    gameMode: string;
	
	    static createFrom(source: any = {}) {
	        return new PanelServerStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.users = this.convertValues(source["users"], PanelUser);
	        this.players = source["players"];
	        this.map = source["map"];
	        this.hostname = source["hostname"];
	        this.name = source["name"];
	        this.serverName = source["serverName"];
	        this.difficulty = source["difficulty"];
	        this.gameMode = source["gameMode"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PlayerInfo {
	    name: string;
	    score: number;
	    duration: number;
	
	    static createFrom(source: any = {}) {
	        return new PlayerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.score = source["score"];
	        this.duration = source["duration"];
	    }
	}
	export class ProblemModScanItem {
	    name: string;
	    path: string;
	    size: number;
	    lastModified: string;
	    title: string;
	    primaryTag: string;
	    secondaryTags: string[];
	    workshopId: string;
	
	    static createFrom(source: any = {}) {
	        return new ProblemModScanItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.lastModified = source["lastModified"];
	        this.title = source["title"];
	        this.primaryTag = source["primaryTag"];
	        this.secondaryTags = source["secondaryTags"];
	        this.workshopId = source["workshopId"];
	    }
	}
	export class ProblemModScanSession {
	    active: boolean;
	    status: string;
	    rootDir: string;
	    round: number;
	    originalEnabled: ProblemModScanItem[];
	    currentCandidates: ProblemModScanItem[];
	    currentDisabled: ProblemModScanItem[];
	    currentEnabled: ProblemModScanItem[];
	    appliedDisabled: ProblemModScanItem[];
	    suspiciousMod?: ProblemModScanItem;
	    startedAt: string;
	    updatedAt: string;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProblemModScanSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.active = source["active"];
	        this.status = source["status"];
	        this.rootDir = source["rootDir"];
	        this.round = source["round"];
	        this.originalEnabled = this.convertValues(source["originalEnabled"], ProblemModScanItem);
	        this.currentCandidates = this.convertValues(source["currentCandidates"], ProblemModScanItem);
	        this.currentDisabled = this.convertValues(source["currentDisabled"], ProblemModScanItem);
	        this.currentEnabled = this.convertValues(source["currentEnabled"], ProblemModScanItem);
	        this.appliedDisabled = this.convertValues(source["appliedDisabled"], ProblemModScanItem);
	        this.suspiciousMod = this.convertValues(source["suspiciousMod"], ProblemModScanItem);
	        this.startedAt = source["startedAt"];
	        this.updatedAt = source["updatedAt"];
	        this.message = source["message"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class RecentServer {
	    name: string;
	    address: string;
	    lastConnectedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new RecentServer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.address = source["address"];
	        this.lastConnectedAt = source["lastConnectedAt"];
	    }
	}
	
	
	export class SavedServer {
	    id?: string;
	    name: string;
	    address: string;
	    weight: number;
	    panelUrl?: string;
	    panelPassword?: string;
	    panelPasswordEncrypted?: string;
	    panelPasswordSet?: boolean;
	    clearPanelPassword?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SavedServer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.address = source["address"];
	        this.weight = source["weight"];
	        this.panelUrl = source["panelUrl"];
	        this.panelPassword = source["panelPassword"];
	        this.panelPasswordEncrypted = source["panelPasswordEncrypted"];
	        this.panelPasswordSet = source["panelPasswordSet"];
	        this.clearPanelPassword = source["clearPanelPassword"];
	    }
	}
	export class ServerInfo {
	    name: string;
	    map: string;
	    players: number;
	    max_players: number;
	    gamedir: string;
	    mode: string;
	
	    static createFrom(source: any = {}) {
	        return new ServerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.map = source["map"];
	        this.players = source["players"];
	        this.max_players = source["max_players"];
	        this.gamedir = source["gamedir"];
	        this.mode = source["mode"];
	    }
	}
	export class ServerStorage {
	    servers: SavedServer[];
	    recentServers: RecentServer[];
	
	    static createFrom(source: any = {}) {
	        return new ServerStorage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.servers = this.convertValues(source["servers"], SavedServer);
	        this.recentServers = this.convertValues(source["recentServers"], RecentServer);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UpdateCheckResult {
	    total_updates: number;
	    new_detected: number;
	
	    static createFrom(source: any = {}) {
	        return new UpdateCheckResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total_updates = source["total_updates"];
	        this.new_detected = source["new_detected"];
	    }
	}
	export class UpdateInfo {
	    has_update: boolean;
	    latest_ver: string;
	    current_ver: string;
	    release_note: string;
	    download_url: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.has_update = source["has_update"];
	        this.latest_ver = source["latest_ver"];
	        this.current_ver = source["current_ver"];
	        this.release_note = source["release_note"];
	        this.download_url = source["download_url"];
	        this.error = source["error"];
	    }
	}
	export class WorkshopChild {
	    publishedfileid: string;
	    sortorder: number;
	    file_type: number;
	
	    static createFrom(source: any = {}) {
	        return new WorkshopChild(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.publishedfileid = source["publishedfileid"];
	        this.sortorder = source["sortorder"];
	        this.file_type = source["file_type"];
	    }
	}
	export class  {
	    preview_url: string;
	    preview_type: number;
	
	    static createFrom(source: any = {}) {
	        return new (source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.preview_url = source["preview_url"];
	        this.preview_type = source["preview_type"];
	    }
	}
	export class WorkshopFileDetails {
	    result: number;
	    publishedfileid: string;
	    creator: string;
	    filename: string;
	    file_size: string;
	    file_url: string;
	    preview_url: string;
	    previews: [];
	    title: string;
	    file_description: string;
	    children: WorkshopChild[];
	
	    static createFrom(source: any = {}) {
	        return new WorkshopFileDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = source["result"];
	        this.publishedfileid = source["publishedfileid"];
	        this.creator = source["creator"];
	        this.filename = source["filename"];
	        this.file_size = source["file_size"];
	        this.file_url = source["file_url"];
	        this.preview_url = source["preview_url"];
	        this.previews = this.convertValues(source["previews"], );
	        this.title = source["title"];
	        this.file_description = source["file_description"];
	        this.children = this.convertValues(source["children"], WorkshopChild);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WorkshopDetailsGroup {
	    root_id: string;
	    main: WorkshopFileDetails;
	    items: WorkshopFileDetails[];
	    downloadable_items: WorkshopFileDetails[];
	
	    static createFrom(source: any = {}) {
	        return new WorkshopDetailsGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.root_id = source["root_id"];
	        this.main = this.convertValues(source["main"], WorkshopFileDetails);
	        this.items = this.convertValues(source["items"], WorkshopFileDetails);
	        this.downloadable_items = this.convertValues(source["downloadable_items"], WorkshopFileDetails);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WorkshopDetailsResult {
	    groups: WorkshopDetailsGroup[];
	
	    static createFrom(source: any = {}) {
	        return new WorkshopDetailsResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groups = this.convertValues(source["groups"], WorkshopDetailsGroup);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class WorkshopPreviewItem {
	    publishedfileid: string;
	    title: string;
	    preview_url: string;
	    creator: string;
	    file_type: number;
	    views: number;
	    subscriptions: number;
	    favorited: number;
	    tags: [];
	
	    static createFrom(source: any = {}) {
	        return new WorkshopPreviewItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.publishedfileid = source["publishedfileid"];
	        this.title = source["title"];
	        this.preview_url = source["preview_url"];
	        this.creator = source["creator"];
	        this.file_type = source["file_type"];
	        this.views = source["views"];
	        this.subscriptions = source["subscriptions"];
	        this.favorited = source["favorited"];
	        this.tags = this.convertValues(source["tags"], );
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class  {
	    tag: string;
	
	    static createFrom(source: any = {}) {
	        return new (source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tag = source["tag"];
	    }
	}
	export class WorkshopPreviewImage {
	    preview_url: string;
	    preview_type: number;
	
	    static createFrom(source: any = {}) {
	        return new WorkshopPreviewImage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.preview_url = source["preview_url"];
	        this.preview_type = source["preview_type"];
	    }
	}
	export class WorkshopItemDetail {
	    publishedfileid: string;
	    title: string;
	    description: string;
	    file_url: string;
	    preview_url: string;
	    previews: WorkshopPreviewImage[];
	    file_type: number;
	    file_size: any;
	    time_created: any;
	    time_updated: any;
	    subscriptions: any;
	    favorited: any;
	    views: any;
	    tags: [];
	    child_items: WorkshopPreviewItem[];
	
	    static createFrom(source: any = {}) {
	        return new WorkshopItemDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.publishedfileid = source["publishedfileid"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.file_url = source["file_url"];
	        this.preview_url = source["preview_url"];
	        this.previews = this.convertValues(source["previews"], WorkshopPreviewImage);
	        this.file_type = source["file_type"];
	        this.file_size = source["file_size"];
	        this.time_created = source["time_created"];
	        this.time_updated = source["time_updated"];
	        this.subscriptions = source["subscriptions"];
	        this.favorited = source["favorited"];
	        this.views = source["views"];
	        this.tags = this.convertValues(source["tags"], );
	        this.child_items = this.convertValues(source["child_items"], WorkshopPreviewItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WorkshopListResult {
	    items: WorkshopPreviewItem[];
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new WorkshopListResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], WorkshopPreviewItem);
	        this.total = source["total"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class WorkshopQueryOptions {
	    page: number;
	    search_text: string;
	    sort: string;
	    tags: string[];
	    filetype: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkshopQueryOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.search_text = source["search_text"];
	        this.sort = source["sort"];
	        this.tags = source["tags"];
	        this.filetype = source["filetype"];
	    }
	}
	export class WorkshopTranslationResult {
	    provider: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkshopTranslationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.text = source["text"];
	    }
	}
	export class WorkshopWatchLaterItem {
	    publishedfileid: string;
	    title: string;
	    preview_url: string;
	    views: number;
	    subscriptions: number;
	    favorited: number;
	    file_type: number;
	    addedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkshopWatchLaterItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.publishedfileid = source["publishedfileid"];
	        this.title = source["title"];
	        this.preview_url = source["preview_url"];
	        this.views = source["views"];
	        this.subscriptions = source["subscriptions"];
	        this.favorited = source["favorited"];
	        this.file_type = source["file_type"];
	        this.addedAt = source["addedAt"];
	    }
	}
	export class WorkshopWatchLaterStorage {
	    items: WorkshopWatchLaterItem[];
	
	    static createFrom(source: any = {}) {
	        return new WorkshopWatchLaterStorage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], WorkshopWatchLaterItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace network {
	
	export class IPOption {
	    ip: string;
	    category: string;
	
	    static createFrom(source: any = {}) {
	        return new IPOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ip = source["ip"];
	        this.category = source["category"];
	    }
	}

}

export namespace parser {
	
	export class ChapterInfo {
	    title: string;
	    modes: string[];
	
	    static createFrom(source: any = {}) {
	        return new ChapterInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.modes = source["modes"];
	    }
	}
	export class VPKFile {
	    name: string;
	    path: string;
	    size: number;
	    primaryTag: string;
	    secondaryTags: string[];
	    location: string;
	    enabled: boolean;
	    campaign: string;
	    chapters: Record<string, ChapterInfo>;
	    mode: string;
	    previewImage: string;
	    lastModified: string;
	    title: string;
	    author: string;
	    version: string;
	    desc: string;
	    addonURL0: string;
	    workshopId: string;
	    hasUpdate: boolean;
	
	    static createFrom(source: any = {}) {
	        return new VPKFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.primaryTag = source["primaryTag"];
	        this.secondaryTags = source["secondaryTags"];
	        this.location = source["location"];
	        this.enabled = source["enabled"];
	        this.campaign = source["campaign"];
	        this.chapters = this.convertValues(source["chapters"], ChapterInfo, true);
	        this.mode = source["mode"];
	        this.previewImage = source["previewImage"];
	        this.lastModified = source["lastModified"];
	        this.title = source["title"];
	        this.author = source["author"];
	        this.version = source["version"];
	        this.desc = source["desc"];
	        this.addonURL0 = source["addonURL0"];
	        this.workshopId = source["workshopId"];
	        this.hasUpdate = source["hasUpdate"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

