import mongoose from "mongoose";

// スキーマでは、ドキュメントがどのような名前、スキーマタイプで構成されているかを定義する
const CoordinateSchema = mongoose.Schema({
  address: String,
  lng: Number,
  lat: Number,
});

// mongoose.modelでスキーマとモデルを紐づけています。
// Coordinateというモデルを通して、MongoDBにアクセスが可能となる
export const Coordinate = mongoose.model("Coordinate", CoordinateSchema);
