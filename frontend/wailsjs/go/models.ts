export namespace main {
	
	export class ConflictGroup {
	    vpk_files: string[];
	    files: string[];
	    severity: string;
	
	    static createFrom(source: any = {}) {
	        return new ConflictGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.vpk_files = source["vpk_files"];
	        this.files = source["files"];
	        this.severity = source["severity"];
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
	        this.created_at = source["created_at"];
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
	    file_size: any;
	    time_created: any;
	    time_updated: any;
	    subscriptions: any;
	    favorited: any;
	    views: any;
	    tags: [];
	
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
	        this.file_size = source["file_size"];
	        this.time_created = source["time_created"];
	        this.time_updated = source["time_updated"];
	        this.subscriptions = source["subscriptions"];
	        this.favorited = source["favorited"];
	        this.views = source["views"];
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
	export class WorkshopPreviewItem {
	    publishedfileid: string;
	    title: string;
	    preview_url: string;
	    creator: string;
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
	
	    static createFrom(source: any = {}) {
	        return new WorkshopQueryOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.search_text = source["search_text"];
	        this.sort = source["sort"];
	        this.tags = source["tags"];
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

