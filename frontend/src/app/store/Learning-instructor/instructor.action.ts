import { createAction, props } from '@ngrx/store';
import { InstructorGridModel, InstructorListModel } from './instructor.model';

// fetch instructorData
export const fetchinstructorListData = createAction('[Data] Fetch instructorlist Table Data');
export const fetchinstructorListSuccess = createAction('[Data] Fetch instructorlist Data Success', props<{ instructorlist: InstructorListModel[] }>());
export const fetchinstructorListFailure = createAction('[Data] Fetch instructorlist Data Failure', props<{ error: string }>());

// fetch instructorData
export const fetchinstructorgridData = createAction('[Data] Fetch instructorgrid Table Data');
export const fetchinstructorgridSuccess = createAction('[Data] Fetch instructorgrid Data Success', props<{ instructorGrid: InstructorGridModel[] }>());
export const fetchinstructorgridFailure = createAction('[Data] Fetch instructorgrid Data Failure', props<{ error: string }>());

// Add Data
export const addinstructorgridData = createAction(
    '[Data] Add instructorgridData',
    props<{ newData: InstructorGridModel }>()
);
export const addinstructorgridDataSuccess = createAction(
    '[Data] Add instructorgridData Success',
    props<{ newData: InstructorGridModel }>()
);
export const addinstructorgridDataFailure = createAction(
    '[Data] Add instructorgridData Failure',
    props<{ error: string }>()
);


// Update Data
export const updateinstructorgridData = createAction(
    '[Data] Update instructorgridData',
    props<{ updatedData: InstructorGridModel }>()
);
export const updateinstructorgridDataSuccess = createAction(
    '[Data] Update instructorgridData Success',
    props<{ updatedData: InstructorGridModel }>()
);
export const updateinstructorgridDataFailure = createAction(
    '[Data] Update instructorgridData Failure',
    props<{ error: string }>()
);

// Delete Data
export const deleteinstructorgridData = createAction(
    '[Data] Delete instructorgridData',
    props<{ id: string }>()
);
export const deleteinstructorgridSuccess = createAction(
    '[Data] Delete instructorgridData Success',
    props<{ id: string }>()
);
export const deleteinstructorgridFailure = createAction(
    '[Data] Delete instructorgridData Failure',
    props<{ error: string }>()
);