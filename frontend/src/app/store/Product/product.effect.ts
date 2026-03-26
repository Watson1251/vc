import { Injectable } from "@angular/core";
import { of } from 'rxjs';
import { catchError, map, mergeMap, tap } from 'rxjs/operators';
import { Actions, createEffect, ofType } from "@ngrx/effects";
import { CrudService } from "src/app/core/services/crud.service";
import { fetchproductsData } from "../Ecommerce/ecommerce.actions";
import { addproductsData, addproductsDataFailure, addproductsDataSuccess, deleteproductsData, deleteproductsFailure, deleteproductsSuccess, fetchproductsFailure, fetchproductsSuccess, updateproductsData, updateproductsDataFailure, updateproductsDataSuccess } from "./product.action";

@Injectable()

export class ProductEffects {
    fetchData$ = createEffect(() =>
        this.actions$.pipe(
            ofType(fetchproductsData),
            mergeMap(() =>
                this.CrudService.fetchData('/app/productList').pipe(
                    map((productlist) => fetchproductsSuccess({ productlist })),

                    catchError((error) =>
                        of(fetchproductsFailure({ error }))
                    )

                )
            )
        )
    );

    addData$ = createEffect(() =>
        this.actions$.pipe(
            ofType(addproductsData),
            mergeMap(({ newData }) =>
                this.CrudService.addData('/app/productList', newData).pipe(
                    map(() => addproductsDataSuccess({ newData })),
                    catchError((error) => of(addproductsDataFailure({ error })))
                )
            )
        )
    );

    updateData$ = createEffect(() =>
        this.actions$.pipe(
            ofType(updateproductsData),
            mergeMap(({ updatedData }) =>
                this.CrudService.updateData('/app/productList', updatedData).pipe(
                    map(() => updateproductsDataSuccess({ updatedData })),
                    catchError((error) => of(updateproductsDataFailure({ error })))
                )
            )
        )
    );

    deleteData$ = createEffect(() =>
        this.actions$.pipe(
            ofType(deleteproductsData),
            mergeMap(({ id }) =>
                this.CrudService.deleteData('/app/productList').pipe(
                    map(() => deleteproductsSuccess({ id })),
                    catchError((error) => of(deleteproductsFailure({ error })))
                )
            )
        )
    );


    constructor(
        private actions$: Actions,
        private CrudService: CrudService
    ) { }
}