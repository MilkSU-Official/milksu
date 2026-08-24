#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    int n; fread(&n,4,1,input); char *p=malloc(n+1); fread(p,1,64,input);
    fclose(input);
    return 0;
}
