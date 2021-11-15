import { ObjectId } from "mongodb";
import { GibbonGroup, GibbonUser } from "../../src/types.js";




export interface TestMongoDbUser extends GibbonUser {
    _id: ObjectId;
    name: string;
    email: string;
}

export interface TestMongoDbGroup extends GibbonGroup {
    _id: ObjectId;
    name: string;
}