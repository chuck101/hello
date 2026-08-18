package pl.example.geo

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.InflaterInputStream
import kotlin.math.*

data class GeoArea(
    val id: Long,
    val level: Int,          // 0 place, 1 gmina, 2 powiat, 3 wojewodztwo
    val name: String,
    val subtype: String?,
    val teryt: String?
)

data class NearbyPlace(
    val id: Long,
    val name: String,
    val subtype: String?,
    val distanceM: Double
)

data class RoadEntry(
    val id: Long,
    val placeId: Long,
    val lat: Double,
    val lon: Double,
    val roadAxisDeg: Int?,
    val roadName: String?,
    val roadRef: String?,
    val distanceM: Double,
    val bearingDeg: Double
)

class OfflineGeoDb(private val context: Context) {
    private val dbFile = File(context.noBackupFilesDir, "poland_places.db")
    private val db: SQLiteDatabase

    init {
        if (!dbFile.exists()) {
            context.assets.open("poland_places.db").use { input ->
                dbFile.outputStream().use { output -> input.copyTo(output) }
            }
        }
        db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READONLY)
    }

    fun areasAt(lat: Double, lon: Double): List<GeoArea> {
        val latE6 = (lat * 1_000_000.0).roundToInt()
        val lonE6 = (lon * 1_000_000.0).roundToInt()
        val cx = floor(lon / 0.05).toInt()
        val cy = floor(lat / 0.05).toInt()
        val out = ArrayList<GeoArea>(4)

        val sql = """
            SELECT a.id,a.level,a.name,a.subtype,a.teryt,a.geom_zlib
            FROM area_cell c
            JOIN area a ON a.id=c.area_id
            WHERE c.cell_x=? AND c.cell_y=?
              AND a.min_lat_e6<=? AND a.max_lat_e6>=?
              AND a.min_lon_e6<=? AND a.max_lon_e6>=?
        """.trimIndent()

        db.rawQuery(sql, arrayOf("$cx", "$cy", "$latE6", "$latE6", "$lonE6", "$lonE6")).use { c ->
            while (c.moveToNext()) {
                val blob = c.getBlob(5)
                if (pointInGeometry(latE6, lonE6, blob)) {
                    out += GeoArea(
                        id = c.getLong(0),
                        level = c.getInt(1),
                        name = c.getString(2),
                        subtype = if (c.isNull(3)) null else c.getString(3),
                        teryt = if (c.isNull(4)) null else c.getString(4)
                    )
                }
            }
        }
        return out
    }

    fun nearbyPlaces(lat: Double, lon: Double, radiusM: Double = 3000.0): List<NearbyPlace> {
        val dLat = radiusM / 111_320.0
        val dLon = radiusM / (111_320.0 * cos(Math.toRadians(lat)).coerceAtLeast(0.1))
        val x0 = floor((lon - dLon) / 0.05).toInt()
        val x1 = floor((lon + dLon) / 0.05).toInt()
        val y0 = floor((lat - dLat) / 0.05).toInt()
        val y1 = floor((lat + dLat) / 0.05).toInt()
        val sql = """
            SELECT DISTINCT a.id,a.name,a.subtype,a.rep_lat_e6,a.rep_lon_e6
            FROM area_cell c JOIN area a ON a.id=c.area_id
            WHERE a.level=0 AND c.cell_x BETWEEN ? AND ? AND c.cell_y BETWEEN ? AND ?
        """.trimIndent()
        val out = ArrayList<NearbyPlace>()
        db.rawQuery(sql, arrayOf("$x0", "$x1", "$y0", "$y1")).use { c ->
            while (c.moveToNext()) {
                val pLat = c.getInt(3) / 1_000_000.0
                val pLon = c.getInt(4) / 1_000_000.0
                val d = haversineM(lat, lon, pLat, pLon)
                if (d <= radiusM) {
                    out += NearbyPlace(
                        c.getLong(0), c.getString(1),
                        if (c.isNull(2)) null else c.getString(2), d
                    )
                }
            }
        }
        return out.sortedBy { it.distanceM }
    }

    fun entriesAhead(lat: Double, lon: Double, headingDeg: Double, radiusM: Double = 1200.0): List<RoadEntry> {
        val dLat = radiusM / 111_320.0
        val dLon = radiusM / (111_320.0 * cos(Math.toRadians(lat)).coerceAtLeast(0.1))
        val minLat = ((lat - dLat) * 1_000_000).roundToInt()
        val maxLat = ((lat + dLat) * 1_000_000).roundToInt()
        val minLon = ((lon - dLon) * 1_000_000).roundToInt()
        val maxLon = ((lon + dLon) * 1_000_000).roundToInt()

        val sql = """
            SELECT id,place_id,lat_e6,lon_e6,road_axis_deg,road_name,road_ref
            FROM entry
            WHERE lat_e6 BETWEEN ? AND ? AND lon_e6 BETWEEN ? AND ?
        """.trimIndent()
        val out = ArrayList<RoadEntry>()
        db.rawQuery(sql, arrayOf("$minLat", "$maxLat", "$minLon", "$maxLon")).use { c ->
            while (c.moveToNext()) {
                val eLat = c.getInt(2) / 1_000_000.0
                val eLon = c.getInt(3) / 1_000_000.0
                val dist = haversineM(lat, lon, eLat, eLon)
                if (dist > radiusM) continue
                val bearing = initialBearing(lat, lon, eLat, eLon)
                if (angleDiff360(headingDeg, bearing) > 55.0) continue

                val axis = if (c.isNull(4)) null else c.getInt(4)
                if (axis != null && axisDiff180(headingDeg, axis.toDouble()) > 35.0) continue

                out += RoadEntry(
                    id = c.getLong(0),
                    placeId = c.getLong(1),
                    lat = eLat,
                    lon = eLon,
                    roadAxisDeg = axis,
                    roadName = if (c.isNull(5)) null else c.getString(5),
                    roadRef = if (c.isNull(6)) null else c.getString(6),
                    distanceM = dist,
                    bearingDeg = bearing
                )
            }
        }
        return out.sortedBy { it.distanceM }
    }

    fun areaName(id: Long): String? =
        db.rawQuery("SELECT name FROM area WHERE id=?", arrayOf("$id")).use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    private fun pointInGeometry(latE6: Int, lonE6: Int, packed: ByteArray): Boolean {
        val raw = InflaterInputStream(ByteArrayInputStream(packed)).readBytes()
        if (raw.size < 7 || raw[0] != 'P'.code.toByte() || raw[1] != 'G'.code.toByte() || raw[2] != '1'.code.toByte()) return false
        val b = ByteBuffer.wrap(raw, 3, raw.size - 3).order(ByteOrder.LITTLE_ENDIAN)
        val polygonCount = b.int
        repeat(polygonCount) {
            val ringCount = b.int
            var inOuter = false
            var inHole = false
            repeat(ringCount) { ringIndex ->
                val n = b.int
                if (n <= 0) return@repeat
                val pts = IntArray(n * 2)
                var lat = b.int
                var lon = b.int
                pts[0] = lat
                pts[1] = lon
                for (i in 1 until n) {
                    lat += b.int
                    lon += b.int
                    pts[i * 2] = lat
                    pts[i * 2 + 1] = lon
                }
                val inside = pointInRing(latE6, lonE6, pts)
                if (ringIndex == 0) inOuter = inside else if (inside) inHole = true
            }
            if (inOuter && !inHole) return true
        }
        return false
    }

    private fun pointInRing(y: Int, x: Int, pts: IntArray): Boolean {
        val n = pts.size / 2
        if (n < 3) return false
        var inside = false
        var j = n - 1
        for (i in 0 until n) {
            val yi = pts[i * 2].toDouble()
            val xi = pts[i * 2 + 1].toDouble()
            val yj = pts[j * 2].toDouble()
            val xj = pts[j * 2 + 1].toDouble()
            val crosses = ((yi > y) != (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
            if (crosses) inside = !inside
            j = i
        }
        return inside
    }

    private fun haversineM(aLat: Double, aLon: Double, bLat: Double, bLon: Double): Double {
        val r = 6_371_000.0
        val p1 = Math.toRadians(aLat)
        val p2 = Math.toRadians(bLat)
        val dp = Math.toRadians(bLat - aLat)
        val dl = Math.toRadians(bLon - aLon)
        val h = sin(dp / 2).pow(2) + cos(p1) * cos(p2) * sin(dl / 2).pow(2)
        return 2 * r * asin(sqrt(h))
    }

    private fun initialBearing(aLat: Double, aLon: Double, bLat: Double, bLon: Double): Double {
        val p1 = Math.toRadians(aLat)
        val p2 = Math.toRadians(bLat)
        val dl = Math.toRadians(bLon - aLon)
        val y = sin(dl) * cos(p2)
        val x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    private fun angleDiff360(a: Double, b: Double): Double = abs((a - b + 540.0) % 360.0 - 180.0)
    private fun axisDiff180(heading: Double, axis: Double): Double = abs((heading - axis + 270.0) % 180.0 - 90.0)
}
