import { GarminError } from "@/errors";
import type { ApiTransferClient } from "../types/api";
import { pathSegment } from "@/util/validate";
import type {
    Course,
    CourseInput,
    CourseList,
    CoursePrivacy,
    CourseUpdate,
} from "../types/courses";

/** Garmin can return HTTP 429 before a new course is ready. */
interface CoursesHost {
    readonly client: ApiTransferClient;
}

export function createCoursesApi(host: CoursesHost) {
    async function listCourses(): Promise<CourseList | null> {
        return host.client.connectapi<CourseList>("/web-gateway/course/owner/");
    }

    /** Garmin uses HTTP 404 when the course does not exist. */
    async function getCourse(
        courseId: number | string,
    ): Promise<Course | null> {
        return host.client.connectapi<Course>(
            `/course-service/course/${pathSegment(courseId)}`,
        );
    }

    /** Parses GPX without saving it. Use `createCourseFromGpx` to parse and save in one call. */
    async function importCourseGpx(
        file: Blob,
        filename: string,
    ): Promise<Course> {
        if (!filename.toLowerCase().endsWith(".gpx")) {
            throw new GarminError(
                `importCourseGpx expects a .gpx file, got "${filename}"`,
            );
        }
        const result = await host.client.upload(
            file,
            filename,
            "/course-service/course/import",
        );
        if (!result || typeof result !== "object") {
            throw new GarminError(
                `Garmin returned no parsed course for "${filename}"`,
            );
        }
        return result as Course;
    }

    /**
     * `activityTypeId` is a Garmin activity type ID. The default is 1 (running).
     */
    async function createCourse(
        input: CourseInput,
    ): Promise<Course | null> {
        if (!input.name.trim())
            throw new GarminError("createCourse requires a non-empty name");
        if (input.geoPoints.length < 2) {
            throw new GarminError("createCourse requires at least two geoPoints");
        }
        const body = {
            activityTypePk: input.activityTypeId ?? 1,
            hasTurnDetectionDisabled: false,
            geoPoints: input.geoPoints,
            courseLines: [],
            coursePoints: input.coursePoints ?? [],
            startPoint: input.geoPoints[0],
            elapsedSeconds: null,
            openStreetMap: false,
            coordinateSystem: "WGS84",
            rulePK: privacyRule(input.privacy ?? "private"),
            courseName: input.name,
            matchedToSegments: false,
            includeLaps: false,
            hasPaceBand: false,
            hasPowerGuide: false,
            favorite: false,
            speedMeterPerSecond: null,
            sourceTypeId: 3,
        };
        return host.client.connectapi<Course>("/course-service/course", {
            method: "POST",
            json: body,
        });
    }

    /** Uses the GPX track name, then the filename, when `name` is omitted. */
    async function createCourseFromGpx(
        file: Blob,
        filename: string,
        options: Omit<CourseInput, "geoPoints" | "coursePoints" | "name"> & {
            name?: string;
        } = {},
    ): Promise<Course | null> {
        const parsed = await importCourseGpx(file, filename);
        const name =
            options.name ?? parsed.courseName ?? filename.replace(/\.gpx$/i, "");
        return createCourse({
            ...options,
            name,
            geoPoints: parsed.geoPoints,
            coursePoints: parsed.coursePoints,
        });
    }

    /** Reads and replaces the full course record. Concurrent updates can overwrite each other. */
    async function updateCourse(
        courseId: number | string,
        changes: CourseUpdate,
    ): Promise<Course | null> {
        if (changes.name === undefined && changes.privacy === undefined) {
            throw new GarminError(
                "updateCourse needs at least one of name or privacy",
            );
        }
        if (changes.name !== undefined && !changes.name.trim()) {
            throw new GarminError("updateCourse cannot set an empty name");
        }
        const path = `/course-service/course/${pathSegment(courseId)}`;
        const current = await host.client.connectapi<Course>(path);
        if (!current)
            throw new GarminError(
                `Cannot update course ${String(courseId)}: Garmin returned nothing`,
            );
        const body: Course = { ...current };
        if (changes.name !== undefined) body.courseName = changes.name;
        if (changes.privacy !== undefined)
            body.rulePK = privacyRule(changes.privacy);
        return host.client.connectapi<Course>(path, { method: "PUT", json: body });
    }

    /** Course deletion cannot be undone. */
    async function deleteCourse(
        courseId: number | string,
    ): Promise<unknown> {
        return host.client.connectapi(
            `/course-service/course/${pathSegment(courseId)}`,
            {
                method: "DELETE",
            },
        );
    }

    async function downloadCourseGpx(
        courseId: number | string,
    ): Promise<Uint8Array> {
        return host.client.download(
            `/course-service/course/gpx/${pathSegment(courseId)}`,
        );
    }

    return {
        list: listCourses,
        get: getCourse,
        importGpx: importCourseGpx,
        create: createCourse,
        createFromGpx: createCourseFromGpx,
        update: updateCourse,
        delete: deleteCourse,
        downloadGpx: downloadCourseGpx,
    };
}

const PRIVACY_RULE: Record<CoursePrivacy, number> = { public: 1, private: 2 };

function privacyRule(privacy: CoursePrivacy): number {
    const rule = PRIVACY_RULE[privacy];
    if (rule === undefined) {
        throw new GarminError(
            `Unknown course privacy "${String(privacy)}" — expected "private" or "public"`,
        );
    }
    return rule;
}
