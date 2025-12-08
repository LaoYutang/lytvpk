export namespace main {
	
	export class DownloadTask {
	    id: string;
	    workshop_id: string;
	    title: string;
	    filename: string;
	    preview_url: string;
	    file_url: string;
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
	        this.status = source["status"];
	        this.progress = source["progress"];
	        this.total_size = source["total_size"];
	        this.downloaded_size = source["downloaded_size"];
	        this.speed = source["speed"];
	        this.error = source["error"];
	        this.created_at = source["created_at"];
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
	    title: string;
	    file_description: string;
	
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
	        this.title = source["title"];
	        this.file_description = source["file_description"];
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
	    // Go type: time
	    lastModified: any;
	    title: string;
	    author: string;
	    version: string;
	    desc: string;
	
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
	        this.lastModified = this.convertValues(source["lastModified"], null);
	        this.title = source["title"];
	        this.author = source["author"];
	        this.version = source["version"];
	        this.desc = source["desc"];
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

