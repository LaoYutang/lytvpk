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

